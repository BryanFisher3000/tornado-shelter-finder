<?php
/**
 * The shelter list and county EM contacts in Supabase: applying approved submissions, and the
 * Shelters and County contacts tabs of the review page. Every change records the reviewer's
 * WordPress name; a database trigger keeps the previous version in shelter_history.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Fields a reviewer may set on a shelter, as the page names them => the shelters column. */
function sas_review_shelter_columns() {
	return array(
		'name'           => 'name',
		'street'         => 'address_line',
		'city'           => 'city',
		'county'         => 'county',
		'state'          => 'state',
		'zip'            => 'zip',
		'lat'            => 'lat',
		'lng'            => 'lng',
		'capacity_label' => 'capacity_label',
		'ada_accessible' => 'ada_accessible',
		'pets_allowed'   => 'pets_allowed',
		'availability'   => 'availability',
		'access'         => 'access',
		'notes'          => 'notes',
		'status'         => 'status',
		'hidden_reason'  => 'hidden_reason',
	);
}

/**
 * Turn page field values into a clean shelters patch. Unknown fields are dropped; bad values
 * return a WP_Error naming the field.
 */
function sas_review_shelter_patch( $changes ) {
	if ( ! is_array( $changes ) ) {
		return array();
	}
	$enums = array(
		'ada_accessible' => array( 'yes', 'no', 'unknown' ),
		'pets_allowed'   => array( 'yes', 'no', 'unknown' ),
		'availability'   => array( 'always', 'emergencies_only', 'county_activated' ),
		'access'         => array( 'public', 'registration_required', 'restricted' ),
		'status'         => array( 'active', 'hidden', 'retired' ),
	);
	$out = array();
	foreach ( sas_review_shelter_columns() as $field => $col ) {
		if ( ! array_key_exists( $field, $changes ) ) {
			continue;
		}
		$v = $changes[ $field ];
		$v = is_scalar( $v ) || null === $v ? trim( sanitize_textarea_field( (string) $v ) ) : '';
		if ( isset( $enums[ $field ] ) ) {
			if ( ! in_array( $v, $enums[ $field ], true ) ) {
				return new WP_Error( 'sas_field', 'That value isn\'t allowed for ' . $field . '.', array( 'status' => 400 ) );
			}
		} elseif ( 'lat' === $field || 'lng' === $field ) {
			if ( ! is_numeric( $v ) ) {
				return new WP_Error( 'sas_field', ( 'lat' === $field ? 'Latitude' : 'Longitude' ) . ' must be a number.', array( 'status' => 400 ) );
			}
			$v = round( (float) $v, 6 );
			if ( ( 'lat' === $field && ( $v <= 18 || $v >= 72 ) ) || ( 'lng' === $field && ( $v <= -180 || $v >= -60 ) ) ) {
				return new WP_Error( 'sas_field', 'That map pin is outside the US.', array( 'status' => 400 ) );
			}
		} elseif ( 'name' === $field && '' === $v ) {
			return new WP_Error( 'sas_field', 'A shelter needs a name.', array( 'status' => 400 ) );
		} elseif ( 'state' === $field ) {
			$v = strtoupper( $v );
			if ( '' !== $v && ! preg_match( '/^[A-Z]{2}$/', $v ) ) {
				return new WP_Error( 'sas_field', 'State must be two letters, like TX.', array( 'status' => 400 ) );
			}
		} elseif ( 'zip' === $field ) {
			$v = substr( preg_replace( '/\D/', '', $v ), 0, 5 );
		}
		if ( 'capacity_label' === $field ) {
			// sanitize_textarea_field() turns the app's "<25" and "<50" into "&lt;25" and "&lt;50"; the list stores the sign itself.
			$v = preg_replace( '/^&lt;(?=\s*\d)/i', '<', $v );
		}
		if ( '' === $v && ! in_array( $field, array( 'lat', 'lng' ), true ) ) {
			$v = null;
		}
		$out[ $col ] = $v;
		if ( 'capacity_label' === $field ) {
			$out['capacity_min'] = null !== $v && preg_match( '/\d[\d,]*/', $v, $m ) ? (int) str_replace( ',', '', $m[0] ) : null;
		}
	}
	return $out;
}

/**
 * A report's proposed_changes in the page's field names. The app sends address corrections as
 * address_line / address_city / address_state / address_zip (null for a field left blank), and
 * availability null when the person picked Unknown; the list always has an Open value, so an
 * Unknown there leaves it as it is.
 */
function sas_review_report_changes( $pc ) {
	$pc = is_array( $pc ) ? $pc : array();
	foreach ( array( 'address_line' => 'street', 'address_city' => 'city', 'address_state' => 'state', 'address_zip' => 'zip' ) as $from => $to ) {
		if ( array_key_exists( $from, $pc ) ) {
			if ( ! array_key_exists( $to, $pc ) ) {
				$pc[ $to ] = $pc[ $from ];
			}
			unset( $pc[ $from ] );
		}
	}
	if ( array_key_exists( 'availability', $pc ) && ( null === $pc['availability'] || '' === $pc['availability'] || 'unknown' === $pc['availability'] ) ) {
		unset( $pc['availability'] );
	}
	return $pc;
}

function sas_review_get_shelter( $id ) {
	$rows = sas_review_supabase( 'GET', 'shelters?select=*&id=eq.' . rawurlencode( $id ) );
	if ( is_wp_error( $rows ) ) {
		return $rows;
	}
	return empty( $rows ) ? null : $rows[0];
}

/**
 * Change one shelter, but only if it is still at $version, so two reviewers can't overwrite each
 * other. Returns the updated row, or a 409 WP_Error when someone changed it first.
 */
function sas_review_update_shelter( $id, $version, $patch, $submission_id = null ) {
	$patch['updated_by']         = sas_review_reviewer_name();
	$patch['last_submission_id'] = $submission_id;
	$rows                        = sas_review_supabase( 'PATCH', 'shelters?id=eq.' . rawurlencode( $id ) . '&version=eq.' . (int) $version, $patch, array( 'Prefer' => 'return=representation' ) );
	if ( is_wp_error( $rows ) ) {
		return $rows;
	}
	if ( empty( $rows ) ) {
		return new WP_Error( 'sas_changed', 'Someone changed this shelter a moment ago. Reload it and try again.', array( 'status' => 409 ) );
	}
	return $rows[0];
}

/** The 12-character id build_shelters.py would give a shelter, so new shelters get the same kind of id. */
function sas_review_new_shelter_id( $name, $street, $city, $state, $lat, $lng ) {
	$key = strtolower( trim( $name ) . '|' . trim( $street ) . '|' . trim( $city ) . '|' . strtoupper( trim( $state ) ) );
	$id  = substr( sha1( $key ), 0, 12 );
	if ( sas_review_get_shelter( $id ) ) {
		$id = substr( sha1( $key . '|' . sprintf( '%.6f,%.6f', $lat, $lng ) ), 0, 12 );
	}
	if ( sas_review_get_shelter( $id ) ) {
		$id = substr( sha1( $key . '|' . microtime() ), 0, 12 );
	}
	return $id;
}

/**
 * Apply an approved submission to the shelter list. Returns the shelter row it changed or added,
 * false when there is nothing to change (feedback, or a report with no field changes), or a
 * WP_Error. With $force false, an edit to a shelter that changed after the person saw it stops
 * with a 409 so the reviewer can look again.
 */
function sas_review_apply_submission( $sub, $force ) {
	$sid = (int) $sub['id'];
	if ( 'add' === $sub['kind'] ) {
		$p = is_array( $sub['proposed_shelter'] ) ? $sub['proposed_shelter'] : array();
		$a = isset( $p['address'] ) && is_array( $p['address'] ) ? $p['address'] : array();
		$l = isset( $p['location'] ) && is_array( $p['location'] ) ? $p['location'] : array();
		$fields = array(
			'name'           => isset( $p['name'] ) ? $p['name'] : '',
			'street'         => isset( $a['street'] ) ? $a['street'] : '',
			'city'           => isset( $a['city'] ) ? $a['city'] : '',
			'county'         => isset( $a['county'] ) ? $a['county'] : '',
			'state'          => isset( $a['state'] ) ? $a['state'] : '',
			'zip'            => isset( $a['zip'] ) ? $a['zip'] : '',
			'lat'            => isset( $l['lat'] ) ? $l['lat'] : '',
			'lng'            => isset( $l['lng'] ) ? $l['lng'] : '',
			'capacity_label' => isset( $p['capacity_label'] ) ? $p['capacity_label'] : '',
			'ada_accessible' => isset( $p['ada_accessible'] ) ? $p['ada_accessible'] : 'unknown',
			'pets_allowed'   => isset( $p['pets_allowed'] ) ? $p['pets_allowed'] : 'unknown',
			'availability'   => isset( $p['availability'] ) ? $p['availability'] : 'emergencies_only',
		);
		if ( '' === trim( (string) $fields['lat'] ) || '' === trim( (string) $fields['lng'] ) ) {
			return new WP_Error( 'sas_field', 'This shelter has no map pin yet. Add its latitude and longitude before approving.', array( 'status' => 400 ) );
		}
		$row = sas_review_shelter_patch( $fields );
		if ( is_wp_error( $row ) ) {
			return $row;
		}
		$row['id']                 = sas_review_new_shelter_id( $row['name'], (string) $row['address_line'], (string) $row['city'], (string) $row['state'], $row['lat'], $row['lng'] );
		$row['status']             = 'active';
		$row['source']             = 'submission #' . $sid;
		$row['updated_by']         = sas_review_reviewer_name();
		$row['last_submission_id'] = $sid;
		$rows                      = sas_review_supabase( 'POST', 'shelters', $row, array( 'Prefer' => 'return=representation' ) );
		return is_wp_error( $rows ) ? $rows : $rows[0];
	}
	if ( 'county' === $sub['kind'] ) {
		return sas_review_apply_county( $sub );
	}
	if ( 'report' !== $sub['kind'] || empty( $sub['shelter_id'] ) ) {
		return false;
	}
	$shelter = sas_review_get_shelter( $sub['shelter_id'] );
	if ( is_wp_error( $shelter ) ) {
		return $shelter;
	}
	if ( ! $shelter ) {
		return new WP_Error( 'sas_missing', 'This shelter is no longer in the list, so there is nothing to change. Reject it or mark it handled.', array( 'status' => 409 ) );
	}
	if ( ! $force && null !== $sub['base_version'] && (int) $shelter['version'] > (int) $sub['base_version'] ) {
		return new WP_Error( 'sas_changed', 'This shelter was changed after the person sent this. Check the current values, then approve again to apply it anyway.', array( 'status' => 409, 'shelter' => $shelter ) );
	}
	$patch = sas_review_shelter_patch( sas_review_report_changes( $sub['proposed_changes'] ) );
	if ( is_wp_error( $patch ) ) {
		return $patch;
	}
	$reasons = is_array( $sub['report_reasons'] ) ? $sub['report_reasons'] : array();
	$gone    = array_values( array_intersect( $reasons, array( 'no_shelter', 'not_public' ) ) );
	if ( $gone ) {
		$patch['status']        = 'hidden';
		$patch['hidden_reason'] = 'no_shelter' === $gone[0] ? 'Reported: no shelter at this location' : 'Reported: not a public shelter';
	}
	foreach ( $patch as $col => $v ) { // drop values that are already the same
		if ( array_key_exists( $col, $shelter ) && (string) $shelter[ $col ] === (string) $v ) {
			unset( $patch[ $col ] );
		}
	}
	if ( ! $patch ) {
		return false;
	}
	return sas_review_update_shelter( $shelter['id'], $shelter['version'], $patch, $sid );
}

/** Approve a county contact correction: apply its changed fields to county_contacts. */
function sas_review_apply_county( $sub ) {
	if ( empty( $sub['county_id'] ) ) {
		return new WP_Error( 'sas_missing', 'This correction isn\'t linked to a county in the list. Make the change in the County contacts tab, then mark it handled.', array( 'status' => 409 ) );
	}
	$rows = sas_review_supabase( 'GET', 'county_contacts?select=*&id=eq.' . (int) $sub['county_id'] );
	if ( is_wp_error( $rows ) ) {
		return $rows;
	}
	if ( empty( $rows ) ) {
		return new WP_Error( 'sas_missing', 'That county is no longer in the list.', array( 'status' => 409 ) );
	}
	$patch = sas_review_county_patch( is_array( $sub['proposed_changes'] ) ? $sub['proposed_changes'] : array() );
	if ( is_wp_error( $patch ) ) {
		return $patch;
	}
	foreach ( $patch as $col => $v ) { // drop values that are already the same
		if ( (string) $rows[0][ $col ] === (string) $v ) {
			unset( $patch[ $col ] );
		}
	}
	if ( ! $patch ) {
		return false;
	}
	$updated = sas_review_county_update( $sub['county_id'], $patch );
	return is_wp_error( $updated ) ? $updated : false;
}

/** PostgREST-safe search term: letters, digits, spaces and a few address characters. */
function sas_review_term( $q ) {
	return trim( preg_replace( '/[^\p{L}\p{N} .\'#&-]/u', ' ', (string) $q ) );
}

/**
 * GET /shelters: ?ids=a,b,c (exact ids, any status), ?near=lat,lng (within about 2 km),
 * or ?q=&state=&status= search. Returns at most 200 rows.
 */
function sas_review_shelters_search( WP_REST_Request $req ) {
	$path = 'shelters?select=*&limit=200';
	if ( $req['ids'] ) {
		$ids = array_filter( array_map( 'trim', explode( ',', (string) $req['ids'] ) ), function ( $x ) {
			return preg_match( '/^[a-z0-9]{6,40}$/', $x );
		} );
		if ( ! $ids ) {
			return rest_ensure_response( array( 'shelters' => array() ) );
		}
		$path .= '&id=in.(' . implode( ',', array_slice( $ids, 0, 200 ) ) . ')';
	} elseif ( $req['near'] ) {
		$ll = array_map( 'floatval', explode( ',', (string) $req['near'] ) );
		if ( count( $ll ) !== 2 ) {
			return new WP_Error( 'sas_near', 'near must be lat,lng', array( 'status' => 400 ) );
		}
		$path .= '&lat=gte.' . ( $ll[0] - 0.02 ) . '&lat=lte.' . ( $ll[0] + 0.02 ) . '&lng=gte.' . ( $ll[1] - 0.025 ) . '&lng=lte.' . ( $ll[1] + 0.025 );
	} else {
		$q = sas_review_term( $req['q'] );
		if ( '' !== $q ) {
			$like  = rawurlencode( '*' . $q . '*' );
			$path .= '&or=(name.ilike.' . $like . ',address_line.ilike.' . $like . ',city.ilike.' . $like . ',county.ilike.' . $like . ',id.eq.' . rawurlencode( strtolower( $q ) ) . ')';
		}
		$state = strtoupper( (string) $req['state'] );
		if ( preg_match( '/^[A-Z]{2}$/', $state ) ) {
			$path .= '&state=eq.' . $state;
		}
		$status = (string) $req['status'];
		if ( in_array( $status, array( 'active', 'hidden', 'retired' ), true ) ) {
			$path .= '&status=eq.' . $status;
		}
		$path .= '&order=updated_at.desc';
	}
	$rows = sas_review_supabase( 'GET', $path );
	return is_wp_error( $rows ) ? $rows : rest_ensure_response( array( 'shelters' => $rows ) );
}

/** GET /shelters/{id}: the shelter plus its last 50 changes. */
function sas_review_shelter_get( WP_REST_Request $req ) {
	$shelter = sas_review_get_shelter( $req['id'] );
	if ( is_wp_error( $shelter ) ) {
		return $shelter;
	}
	if ( ! $shelter ) {
		return new WP_Error( 'sas_missing', 'No shelter with that id.', array( 'status' => 404 ) );
	}
	$history = sas_review_supabase( 'GET', 'shelter_history?select=id,version,old_row,new_row,changed_by,submission_id,changed_at&shelter_id=eq.' . rawurlencode( $shelter['id'] ) . '&order=changed_at.desc,id.desc&limit=50' );
	if ( is_wp_error( $history ) ) {
		return $history;
	}
	return rest_ensure_response( array( 'shelter' => $shelter, 'history' => $history ) );
}

/** POST /shelters/{id} {version, changes}: a reviewer's direct edit. */
function sas_review_shelter_save( WP_REST_Request $req ) {
	$patch = sas_review_shelter_patch( $req['changes'] );
	if ( is_wp_error( $patch ) ) {
		return $patch;
	}
	if ( ! $patch ) {
		return new WP_Error( 'sas_nothing', 'Nothing changed.', array( 'status' => 400 ) );
	}
	$row = sas_review_update_shelter( $req['id'], (int) $req['version'], $patch );
	return is_wp_error( $row ) ? $row : rest_ensure_response( array( 'shelter' => $row ) );
}

/**
 * POST /shelters/{id}/undo {history_id, version}: put back the values the shelter had before that
 * change. Undoing the shelter's creation hides it. The undo is itself a change, so it can be undone.
 */
function sas_review_shelter_undo( WP_REST_Request $req ) {
	$h = sas_review_supabase( 'GET', 'shelter_history?select=*&id=eq.' . (int) $req['history_id'] . '&shelter_id=eq.' . rawurlencode( $req['id'] ) );
	if ( is_wp_error( $h ) ) {
		return $h;
	}
	if ( empty( $h ) ) {
		return new WP_Error( 'sas_missing', 'That change isn\'t in this shelter\'s history.', array( 'status' => 404 ) );
	}
	$old = $h[0]['old_row'];
	if ( ! is_array( $old ) ) {
		$patch = array( 'status' => 'hidden', 'hidden_reason' => 'Undid adding this shelter' );
	} else {
		$patch = array();
		foreach ( sas_review_shelter_columns() as $col ) {
			if ( array_key_exists( $col, $old ) ) {
				$patch[ $col ] = $old[ $col ];
			}
		}
		$patch['capacity_min'] = isset( $old['capacity_min'] ) ? $old['capacity_min'] : null;
	}
	$row = sas_review_update_shelter( $req['id'], (int) $req['version'], $patch );
	return is_wp_error( $row ) ? $row : rest_ensure_response( array( 'shelter' => $row ) );
}

/** GET /counties ?q=&state= ; at most 200, alphabetical. */
function sas_review_counties_search( WP_REST_Request $req ) {
	$path = 'county_contacts?select=*&limit=200&order=state.asc,county.asc';
	$ids  = array_filter( array_map( 'intval', explode( ',', (string) $req['ids'] ) ) );
	if ( $ids ) {
		$rows = sas_review_supabase( 'GET', 'county_contacts?select=*&id=in.(' . implode( ',', array_slice( $ids, 0, 200 ) ) . ')' );
		return is_wp_error( $rows ) ? $rows : rest_ensure_response( array( 'counties' => $rows ) );
	}
	$q    = sas_review_term( $req['q'] );
	if ( '' !== $q ) {
		$like  = rawurlencode( '*' . $q . '*' );
		$path .= '&or=(county.ilike.' . $like . ',agency.ilike.' . $like . ',director.ilike.' . $like . ',email.ilike.' . $like . ')';
	}
	$state = strtoupper( (string) $req['state'] );
	if ( preg_match( '/^[A-Z]{2}$/', $state ) ) {
		$path .= '&state=eq.' . $state;
	}
	if ( $req['missing'] ) {
		$path .= '&agency=is.null&director=is.null&phone=is.null&email=is.null';
	}
	$rows = sas_review_supabase( 'GET', $path );
	return is_wp_error( $rows ) ? $rows : rest_ensure_response( array( 'counties' => $rows ) );
}

/** Turn county field values into a clean county_contacts patch, or a WP_Error naming the field. */
function sas_review_county_patch( $changes ) {
	$changes = is_array( $changes ) ? $changes : array();
	$patch   = array();
	foreach ( array( 'agency', 'director', 'phone', 'email', 'address', 'website', 'source_url', 'source_date' ) as $f ) {
		if ( array_key_exists( $f, $changes ) ) {
			$v           = trim( sanitize_textarea_field( (string) $changes[ $f ] ) );
			$patch[ $f ] = '' === $v ? null : $v;
		}
	}
	if ( isset( $patch['email'] ) && ! is_email( $patch['email'] ) ) {
		return new WP_Error( 'sas_field', 'That email address doesn\'t look right.', array( 'status' => 400 ) );
	}
	return $patch;
}

/** Save a county_contacts patch. Returns the updated rows or a WP_Error. */
function sas_review_county_update( $id, $patch ) {
	$patch['updated_by'] = sas_review_reviewer_name();
	$patch['updated_at'] = gmdate( 'c' );
	$rows                = sas_review_supabase( 'PATCH', 'county_contacts?id=eq.' . (int) $id, $patch, array( 'Prefer' => 'return=representation' ) );
	if ( ! is_wp_error( $rows ) ) {
		sas_county_contacts_flush();
	}
	return $rows;
}

/** POST /counties/{id} {changes}: edit one county's contact details. */
function sas_review_county_save( WP_REST_Request $req ) {
	$patch = sas_review_county_patch( $req['changes'] );
	if ( is_wp_error( $patch ) ) {
		return $patch;
	}
	if ( ! $patch ) {
		return new WP_Error( 'sas_nothing', 'Nothing changed.', array( 'status' => 400 ) );
	}
	$rows = sas_review_county_update( $req['id'], $patch );
	if ( is_wp_error( $rows ) ) {
		return $rows;
	}
	return empty( $rows ) ? new WP_Error( 'sas_missing', 'No county with that id.', array( 'status' => 404 ) ) : rest_ensure_response( array( 'county' => $rows[0] ) );
}
