<?php
/**
 * Send the website's Formidable forms into the review queue.
 *
 * When someone submits the "Suggest an Edit" shelter form (fields keyed sfb_*, form 44), the
 * finder page's "Add a Shelter" form (form 39), the Add a Shelter page's own form (fields keyed
 * sas_add_*, made from wordpress/forms/add-a-shelter-form.xml) or the county EM contact form
 * (fields keyed cemf_*, form 45), this adds a row to public.submissions so it shows on the review
 * page and in the daily digest, next to the app's submissions. The forms are recognised by their
 * field keys, not their ids, and Formidable still keeps its own copy of each entry.
 *
 * The two shelter forms are drawn like the app's by assets/shelter-forms.js. That script puts the
 * person's answers into the Formidable fields in a few fixed spellings, which are read back here:
 * capacity as "Under 25", "Under 50" or "50 or more" (sas_forms_capacity), the three report
 * checkboxes as a first line "Reported: ..." of the message (sas_forms_note), and, on form 39,
 * the shelter's name and its Open choice inside the note (sas_forms_add_note). The Add a Shelter
 * page's form has a field for each of the app's, so nothing in it is packed: only its choices are
 * read the same way ("Under 25", "Unknown").
 *
 * The shelter forms need a signed-in account, the app's own (includes/account.php), so each of
 * their rows carries submitter_id and the account's name and email.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'frm_after_create_entry', 'sas_forms_after_entry', 30, 2 );

/** Entry values keyed by field key, e.g. array( 'sfb_name' => 'Derby Rec. Center' ). */
function sas_forms_values( $entry_id, $form_id ) {
	if ( ! class_exists( 'FrmEntry' ) || ! class_exists( 'FrmField' ) ) {
		return array();
	}
	$entry = FrmEntry::getOne( $entry_id, true );
	if ( ! $entry || empty( $entry->metas ) ) {
		return array();
	}
	$out = array();
	foreach ( FrmField::get_all_for_form( $form_id ) as $f ) {
		if ( isset( $entry->metas[ $f->id ] ) ) {
			$v                    = $entry->metas[ $f->id ];
			$out[ $f->field_key ] = trim( is_array( $v ) ? implode( ', ', $v ) : (string) $v );
		}
	}
	return $out;
}

function sas_forms_after_entry( $entry_id, $form_id ) {
	$v = sas_forms_values( $entry_id, $form_id );
	if ( isset( $v['sfb_name'] ) || isset( $v['sfb_orig_name'] ) ) {
		$row = sas_forms_shelter_submission( $v );
	} elseif ( isset( $v['sas_add_name'] ) || isset( $v['sas_add_street'] ) ) {
		$row = sas_forms_page_add_submission( $v );
	} elseif ( array_intersect_key( $v, array_flip( sas_forms_add_keys() ) ) ) {
		$row = sas_forms_add_submission( $v );
	} elseif ( isset( $v['cemf_county'] ) || isset( $v['cemf_orig_county'] ) ) {
		$row = sas_forms_county_submission( $v );
	} else {
		return;
	}
	$row['channel']          = 'website-form';
	$row['submitter_device'] = 'Formidable form ' . (int) $form_id . ', entry ' . (int) $entry_id;
	// A shelter form is sent by someone signed in (includes/account.php): the review queue gets the
	// account itself, as it does from the app, in place of the name and email fields.
	if ( function_exists( 'sas_account_applies' ) && sas_account_applies( $form_id ) ) {
		$acct = sas_account_current();
		if ( ! is_wp_error( $acct ) ) {
			$row['submitter_id'] = $acct['id'];
			$row['submitter']    = sas_account_submitter( $acct );
		}
	}
	$res                     = sas_review_supabase( 'POST', 'submissions', $row, array( 'Prefer' => 'return=minimal' ) );
	if ( is_wp_error( $res ) ) {
		error_log( 'SAS Shelter Review: could not add form entry ' . (int) $entry_id . ' to the review queue: ' . $res->get_error_message() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions
	}
}

function sas_forms_g( $v, $k ) {
	return isset( $v[ $k ] ) ? trim( (string) $v[ $k ] ) : '';
}

/** Two-letter code for a state given as a code or a full name ("KS" or "Kansas"). */
function sas_forms_state_code( $s ) {
	$s = trim( (string) $s );
	if ( preg_match( '/^[A-Za-z]{2}$/', $s ) ) {
		return strtoupper( $s );
	}
	$code = array_search( strtolower( $s ), array_map( 'strtolower', sas_county_state_names() ), true );
	return false === $code ? '' : $code;
}

function sas_forms_submitter( $first, $last, $email, $role = '' ) {
	if ( '' === $first && '' === $last && '' === $email ) {
		return null;
	}
	$m = array( 'first_name' => $first, 'last_name' => $last, 'email' => $email );
	if ( '' !== $role ) {
		$m['role'] = $role;
	}
	return $m;
}

/** "Yes" / "No" / "Service animals only" / "Unknown" as the table stores them. */
function sas_forms_tri( $s ) {
	$s = strtolower( trim( (string) $s ) );
	if ( '' === $s || 'unknown' === $s ) {
		return 'unknown';
	}
	if ( false !== strpos( $s, 'service' ) ) {
		return 'no';
	}
	return 'y' === $s[0] ? 'yes' : ( 'n' === $s[0] ? 'no' : 'unknown' );
}

function sas_forms_open( $s ) {
	$s = strtolower( trim( (string) $s ) );
	if ( '' === $s || 'unknown' === $s ) {
		return '';
	}
	if ( preg_match( '/year|always|24\/7/', $s ) ) {
		return 'always';
	}
	if ( false !== strpos( $s, 'county' ) ) {
		return 'county_activated';
	}
	return 'emergencies_only';
}

/** The form's report checkboxes (field sfb_reasons) as the codes the app sends. */
function sas_forms_reasons( $s ) {
	$s   = strtolower( (string) $s );
	$out = array();
	if ( false !== strpos( $s, 'address' ) ) {
		$out[] = 'address_wrong';
	}
	if ( false !== strpos( $s, 'no shelter' ) ) {
		$out[] = 'no_shelter';
	}
	if ( false !== strpos( $s, 'not a public' ) ) {
		$out[] = 'not_public';
	}
	return $out;
}

/**
 * The app's capacity choices. The redrawn website form sends them as words, because "<25" does not
 * survive a WordPress form field and Formidable does not keep an empty answer ("Unknown" stands for
 * none); anything else (a number typed into the old form) is kept as typed.
 */
function sas_forms_capacity( $s ) {
	$s   = trim( str_ireplace( '&lt;', '<', (string) $s ) );
	$map = array(
		'unknown'    => '',
		'under 25'   => '<25',
		'under 50'   => '<50',
		'50 or more' => '50+',
		'<25'        => '<25',
		'<50'        => '<50',
		'50+'        => '50+',
	);
	$key = strtolower( preg_replace( '/\s+/', ' ', $s ) );
	return isset( $map[ $key ] ) ? $map[ $key ] : $s;
}

/** An address box the person emptied arrives as "(blank)", because Formidable does not keep an empty answer. */
function sas_forms_text( $s ) {
	$s = trim( (string) $s );
	return 0 === strcasecmp( $s, '(blank)' ) ? '' : $s;
}

/** A map pin as the review queue keeps it, or null when the two numbers are not a place on the map. */
function sas_forms_pin( $lat, $lng ) {
	if ( ! is_numeric( $lat ) || ! is_numeric( $lng ) || abs( (float) $lat ) > 90 || abs( (float) $lng ) > 180 ) {
		return null;
	}
	return array( 'lat' => (float) $lat, 'lng' => (float) $lng );
}

/**
 * The message of the redrawn Suggest an Edit form: an optional first line "Reported: Address is
 * wrong; No shelter at this location" (its three checkboxes), then the person's note, or
 * "(no note)" when they wrote nothing. Returns array( reason codes, note ).
 */
function sas_forms_note( $message ) {
	$message = trim( str_replace( array( "\r\n", "\r" ), "\n", (string) $message ) );
	$reasons = array();
	$one     = '(?:Address is wrong|No shelter at this location|Not a public shelter)';
	if ( preg_match( '/^Reported: (' . $one . '(?:; ' . $one . ')*)[ \t]*(?:\n|$)/', $message, $m ) ) {
		$reasons = sas_forms_reasons( $m[1] );
		$message = trim( substr( $message, strlen( $m[0] ) ) );
	}
	if ( 0 === strcasecmp( $message, '(no note)' ) ) {
		$message = '';
	}
	return array( $reasons, $message );
}

/** The finder page's "Add a Shelter" form (Formidable form 39): what each of its field keys holds. */
function sas_forms_add_keys() {
	return array(
		'street'   => 'stacy',
		'city'     => 'ygxp5',
		'county'   => 'zl89t',
		'state'    => 'adej1',
		'zip'      => 'zrhlf',
		'capacity' => '2jfhz',
		'ada'      => '98mz1',
		'pets'     => '6p19c',
		'note'     => '9gy75',
		'lat'      => 'u0803',
		'lng'      => 'svf42',
		'first'    => '1imzl',
		'last'     => 'sof1r',
		'email'    => 'k5ihj',
	);
}

/**
 * Form 39 has no box for the shelter's name or for when it is open, so the redrawn form sends both
 * in its note: "Name: First Baptist Church || Open: Year-round || Note: Enter by the flag poles."
 * Returns array( name, open as typed, note ); a note written any other way comes back whole.
 */
function sas_forms_add_note( $note ) {
	$note = trim( (string) $note );
	if ( preg_match( '/^Name: (.*?) \|\| Open: (Year-round|During emergencies|Unknown) \|\| Note:(.*)$/s', $note, $m ) ) {
		return array( trim( $m[1] ), 'Unknown' === $m[2] ? '' : $m[2], trim( $m[3] ) );
	}
	return array( '', '', $note );
}

/** Find the shelter the form was opened from, by its original name, city and state (nearest pin wins). */
function sas_forms_find_shelter( $name, $city, $state, $lat, $lng ) {
	if ( '' === $name || '' === $state ) {
		return null;
	}
	$rows = sas_review_supabase( 'GET', 'shelters?select=id,version,name,address_line,city,state,lat,lng&state=eq.' . rawurlencode( $state ) . '&name=eq.' . rawurlencode( $name ) . '&limit=50' );
	if ( is_wp_error( $rows ) || empty( $rows ) ) {
		return null;
	}
	$same = array_values(
		array_filter(
			$rows,
			function ( $r ) use ( $city ) {
				return '' === $city || 0 === strcasecmp( trim( (string) $r['city'] ), $city );
			}
		)
	);
	$list = $same ? $same : $rows;
	if ( is_numeric( $lat ) && is_numeric( $lng ) ) {
		usort(
			$list,
			function ( $a, $b ) use ( $lat, $lng ) {
				$da = pow( $a['lat'] - $lat, 2 ) + pow( $a['lng'] - $lng, 2 );
				$db = pow( $b['lat'] - $lat, 2 ) + pow( $b['lng'] - $lng, 2 );
				return $da <=> $db;
			}
		);
	}
	return $list[0];
}

function sas_forms_shelter_submission( $v ) {
	$g     = function ( $k ) use ( $v ) {
		return sas_forms_g( $v, $k );
	};
	$state = sas_forms_state_code( $g( 'sfb_orig_state' ) ? $g( 'sfb_orig_state' ) : $g( 'sfb_state' ) );
	$found = sas_forms_find_shelter( $g( 'sfb_orig_name' ), $g( 'sfb_orig_city' ), $state, $g( 'sfb_orig_lat' ), $g( 'sfb_orig_lng' ) );

	// form field => array( review field, original field, how to read it )
	$map     = array(
		'sfb_name'     => array( 'name', 'sfb_orig_name', null ),
		'sfb_address'  => array( 'street', 'sfb_orig_address', 'sas_forms_text' ),
		'sfb_city'     => array( 'city', 'sfb_orig_city', 'sas_forms_text' ),
		'sfb_county'   => array( 'county', 'sfb_orig_county', null ),
		'sfb_state'    => array( 'state', 'sfb_orig_state', 'sas_forms_state_code' ),
		'sfb_zip'      => array( 'zip', 'sfb_orig_zip', 'sas_forms_text' ),
		'sfb_capacity' => array( 'capacity_label', 'sfb_orig_capacity', 'sas_forms_capacity' ),
		'sfb_ada'      => array( 'ada_accessible', 'sfb_orig_ada', 'sas_forms_tri' ),
		'sfb_pets'     => array( 'pets_allowed', 'sfb_orig_pets', 'sas_forms_tri' ),
		'sfb_open'     => array( 'availability', 'sfb_orig_open', 'sas_forms_open' ),
		'sfb_lat'      => array( 'lat', 'sfb_orig_lat', null ),
		'sfb_lng'      => array( 'lng', 'sfb_orig_lng', null ),
		'sfb_note'     => array( 'notes', 'sfb_orig_note', null ),
	);
	$changes = array();
	foreach ( $map as $new_key => $m ) {
		if ( ! isset( $v[ $new_key ] ) ) {
			continue;
		}
		$new = $m[2] ? call_user_func( $m[2], $g( $new_key ) ) : $g( $new_key );
		$old = $m[2] ? call_user_func( $m[2], $g( $m[1] ) ) : $g( $m[1] );
		if ( $new !== $old && ! ( '' === $g( $new_key ) && '' === $g( $m[1] ) ) ) {
			$changes[ $m[0] ] = $new;
		}
	}

	list( $said, $note ) = sas_forms_note( $g( 'sfb_message' ) );
	$label               = $g( 'sfb_orig_name' ) ? $g( 'sfb_orig_name' ) : $g( 'sfb_name' );
	$pre                 = $g( 'sfb_orig_name' ) ? 'sfb_orig_' : 'sfb_';
	$where               = implode( ', ', array_filter( array( $g( $pre . 'address' ), $g( $pre . 'city' ), $state ) ) );
	$row                 = array(
		'status'           => 'pending',
		'comment'          => $note,
		'submitter'        => sas_forms_submitter( $g( 'sfb_first' ), $g( 'sfb_last' ), $g( 'sfb_email' ) ),
		'shelter_label'    => $label . ( $where ? ' — ' . $where : '' ),
		'proposed_changes' => (object) $changes,
	);
	$reasons = array_values( array_unique( array_merge( sas_forms_reasons( $g( 'sfb_reasons' ) ), $said ) ) );
	if ( $found ) {
		$row['kind']           = 'report';
		$row['report_reasons'] = $reasons;
		$row['shelter_id']   = $found['id'];
		$row['base_version'] = (int) $found['version'];
		return $row;
	}
	if ( '' === $g( 'sfb_orig_name' ) && '' !== $g( 'sfb_name' ) ) { // opened blank: a new shelter
		$row['kind']             = 'add';
		$row['proposed_changes'] = (object) array();
		$row['proposed_shelter'] = array(
			'name'           => $g( 'sfb_name' ),
			'address'        => array( 'street' => $g( 'sfb_address' ), 'city' => $g( 'sfb_city' ), 'county' => $g( 'sfb_county' ), 'state' => sas_forms_state_code( $g( 'sfb_state' ) ), 'zip' => $g( 'sfb_zip' ) ),
			'location'       => sas_forms_pin( $g( 'sfb_lat' ), $g( 'sfb_lng' ) ),
			'capacity_label' => '' !== sas_forms_capacity( $g( 'sfb_capacity' ) ) ? sas_forms_capacity( $g( 'sfb_capacity' ) ) : null,
			'ada_accessible' => sas_forms_tri( $g( 'sfb_ada' ) ),
			'pets_allowed'   => sas_forms_tri( $g( 'sfb_pets' ) ),
			// Unknown is sent as nothing, like the app; approving then lists it as open during emergencies.
			'availability'   => sas_forms_open( $g( 'sfb_open' ) ) ? sas_forms_open( $g( 'sfb_open' ) ) : null,
		);
		return $row;
	}
	// Couldn't match it to a shelter in the list: keep it as feedback with the details spelled out.
	$row['kind'] = 'general';
	$lines       = array();
	if ( $reasons ) {
		$lines[] = 'reported: ' . implode( ', ', $reasons );
	}
	foreach ( $changes as $k => $val ) {
		$lines[] = $k . ': ' . $val;
	}
	$row['comment'] = trim( 'Suggested edit for "' . $row['shelter_label'] . '" (not matched to a shelter in the list).' . ( $lines ? "\nChanges: " . implode( '; ', $lines ) : '' ) . "\n\n" . $row['comment'] );
	return $row;
}

/** An entry of the finder page's "Add a Shelter" form (form 39) as a new shelter for the review queue. */
function sas_forms_add_submission( $v ) {
	$in = array();
	foreach ( sas_forms_add_keys() as $what => $key ) {
		$in[ $what ] = sas_forms_g( $v, $key );
	}
	list( $in['name'], $in['open'], $in['note'] ) = sas_forms_add_note( $in['note'] );
	return sas_forms_add_row( $in );
}

/** What the Add a Shelter page's own form asks for: each is a field keyed sas_add_ and the word here. */
function sas_forms_page_add_fields() {
	return array( 'name', 'street', 'city', 'county', 'state', 'zip', 'capacity', 'open', 'ada', 'pets', 'note', 'lat', 'lng', 'first', 'last', 'email' );
}

/** An entry of the Add a Shelter page's own form (fields keyed sas_add_*) as a new shelter for the review queue. */
function sas_forms_page_add_submission( $v ) {
	$in = array();
	foreach ( sas_forms_page_add_fields() as $what ) {
		$in[ $what ] = sas_forms_g( $v, 'sas_add_' . $what );
	}
	return sas_forms_add_row( $in );
}

/**
 * A new shelter for the review queue from what an Add a Shelter form sent. $in holds, as typed:
 * name, street, city, county, state, zip, lat, lng, capacity, ada, pets, open, note, first, last, email.
 */
function sas_forms_add_row( $in ) {
	$g = function ( $f ) use ( $in ) {
		return isset( $in[ $f ] ) ? trim( (string) $in[ $f ] ) : '';
	};
	$name     = $g( 'name' );
	$note     = trim( str_replace( array( "\r\n", "\r" ), "\n", $g( 'note' ) ) );
	$state    = sas_forms_state_code( $g( 'state' ) );
	$where    = implode( ', ', array_filter( array( $g( 'street' ), $g( 'city' ), $state ) ) );
	$capacity = sas_forms_capacity( $g( 'capacity' ) );
	$row      = array(
		'status'           => 'pending',
		'comment'          => $note,
		'submitter'        => sas_forms_submitter( $g( 'first' ), $g( 'last' ), $g( 'email' ) ),
		'shelter_label'    => ( '' !== $name ? $name : 'New shelter' ) . ( $where ? ' — ' . $where : '' ),
		'proposed_changes' => (object) array(),
	);
	if ( '' === $name ) {
		// Sent from the form as it was before it was redrawn, which never asked for a name: keep it
		// as feedback with the details spelled out, so a reviewer can add the shelter by hand.
		$row['kind'] = 'general';
		$lines       = array();
		$said        = array(
			'address'               => implode( ', ', array_filter( array( $g( 'street' ), $g( 'city' ), $g( 'county' ), $g( 'state' ), $g( 'zip' ) ) ) ),
			'map pin'               => implode( ', ', array_filter( array( $g( 'lat' ), $g( 'lng' ) ), 'strlen' ) ),
			'capacity'              => $capacity,
			'wheelchair accessible' => $g( 'ada' ),
			'pets allowed'          => $g( 'pets' ),
		);
		foreach ( $said as $what => $val ) {
			if ( '' !== $val ) {
				$lines[] = $what . ': ' . $val;
			}
		}
		$row['comment'] = trim( 'Sent from the website\'s Add a Shelter form without a shelter name.' . ( $lines ? "\nDetails: " . implode( '; ', $lines ) : '' ) . "\n\n" . $note );
		return $row;
	}
	$row['kind']             = 'add';
	$row['proposed_shelter'] = array(
		'name'           => $name,
		'address'        => array( 'street' => $g( 'street' ), 'city' => $g( 'city' ), 'county' => $g( 'county' ), 'state' => $state, 'zip' => $g( 'zip' ) ),
		'location'       => sas_forms_pin( $g( 'lat' ), $g( 'lng' ) ),
		'capacity_label' => '' !== $capacity ? $capacity : null,
		'ada_accessible' => sas_forms_tri( $g( 'ada' ) ),
		'pets_allowed'   => sas_forms_tri( $g( 'pets' ) ),
		// Unknown is sent as nothing, like the app; approving then lists it as open during emergencies.
		'availability'   => sas_forms_open( $g( 'open' ) ) ? sas_forms_open( $g( 'open' ) ) : null,
	);
	return $row;
}

function sas_forms_county_submission( $v ) {
	$g      = function ( $k ) use ( $v ) {
		return sas_forms_g( $v, $k );
	};
	$county = $g( 'cemf_orig_county' ) ? $g( 'cemf_orig_county' ) : $g( 'cemf_county' );
	$state  = sas_forms_state_code( $g( 'cemf_orig_state' ) ? $g( 'cemf_orig_state' ) : $g( 'cemf_state' ) );
	$found  = null;
	if ( '' !== $county && '' !== $state ) {
		$name  = preg_replace( '/\s+(County|Parish)$/i', '', $county );
		$rows  = sas_review_supabase( 'GET', 'county_contacts?select=id&state=eq.' . $state . '&county=ilike.' . rawurlencode( str_replace( array( '*', ',' ), '', $name ) ) );
		$found = ! is_wp_error( $rows ) && ! empty( $rows ) ? $rows[0] : null;
	}
	$changes = array();
	foreach ( array( 'agency', 'director', 'phone', 'email', 'address', 'website' ) as $f ) {
		if ( isset( $v[ 'cemf_' . $f ] ) && $g( 'cemf_' . $f ) !== $g( 'cemf_orig_' . $f ) ) {
			$changes[ $f ] = $g( 'cemf_' . $f );
		}
	}
	$label = trim( $county . ( $state ? ', ' . $state : '' ) );
	$row   = array(
		'status'           => 'pending',
		'comment'          => $g( 'cemf_message' ),
		'submitter'        => sas_forms_submitter( $g( 'cemf_first' ), $g( 'cemf_last' ), $g( 'cemf_your_email' ), $g( 'cemf_role' ) ),
		'shelter_label'    => $label,
		'proposed_changes' => (object) $changes,
	);
	if ( $found ) {
		$row['kind']      = 'county';
		$row['county_id'] = (int) $found['id'];
		return $row;
	}
	$row['kind']    = 'general';
	$lines          = array();
	foreach ( $changes as $k => $val ) {
		$lines[] = $k . ': ' . $val;
	}
	$row['comment'] = trim( 'County contact correction for "' . $label . '" (not matched to a county in the list).' . ( $lines ? "\nChanges: " . implode( '; ', $lines ) : '' ) . "\n\n" . $row['comment'] );
	return $row;
}
