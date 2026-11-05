<?php
/**
 * Public county emergency management contacts list.
 * Shortcode: [sas_county_contacts]
 *   Optional: edit_url="edit/" (where each county's Edit link goes; the page's script adds the
 *   county's current details to it and opens it in a pop-up), edit_url="" to hide the Edit links.
 * It prints the same markup, styles and scripts as the hand-built list it replaces (class sas-em),
 * filled from public.county_contacts in Supabase. The rows are cached for an hour; saving a county
 * on the review page clears the cache, so edits show right away.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SAS_COUNTY_CACHE', 'sas_county_contacts_v1' );

/** All county contacts, cached. Returns an array of rows, or WP_Error. */
function sas_county_contacts_all() {
	$rows = get_transient( SAS_COUNTY_CACHE );
	if ( is_array( $rows ) ) {
		return $rows;
	}
	$rows = array();
	for ( $from = 0; $from < 20000; $from += 1000 ) {
		$page = sas_review_supabase(
			'GET',
			'county_contacts?select=state,county,agency,director,phone,email,address,website&order=state.asc,county.asc',
			null,
			array( 'Range' => $from . '-' . ( $from + 999 ) )
		);
		if ( is_wp_error( $page ) ) {
			return $page;
		}
		$rows = array_merge( $rows, (array) $page );
		if ( count( $page ) < 1000 ) {
			break;
		}
	}
	set_transient( SAS_COUNTY_CACHE, $rows, HOUR_IN_SECONDS );
	return $rows;
}

/** True while a page builder or the block editor renders the page for editing, not for a visitor. */
function sas_county_in_editor() {
	// phpcs:disable WordPress.Security.NonceVerification.Recommended
	$editor = is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST )
		|| isset( $_REQUEST['vcv-ajax'] ) || isset( $_REQUEST['vcv-action'] ) || isset( $_REQUEST['vcv-editable'] )
		|| isset( $_REQUEST['vcv-source-id'] ) || isset( $_REQUEST['vc_editable'] ) || isset( $_REQUEST['elementor-preview'] );
	// phpcs:enable
	return (bool) apply_filters( 'sas_county_in_editor', $editor );
}

function sas_county_contacts_flush() {
	delete_transient( SAS_COUNTY_CACHE );
}

function sas_county_state_names() {
	return array(
		'AL' => 'Alabama', 'AK' => 'Alaska', 'AZ' => 'Arizona', 'AR' => 'Arkansas', 'CA' => 'California', 'CO' => 'Colorado',
		'CT' => 'Connecticut', 'DE' => 'Delaware', 'FL' => 'Florida', 'GA' => 'Georgia', 'HI' => 'Hawaii', 'ID' => 'Idaho',
		'IL' => 'Illinois', 'IN' => 'Indiana', 'IA' => 'Iowa', 'KS' => 'Kansas', 'KY' => 'Kentucky', 'LA' => 'Louisiana',
		'ME' => 'Maine', 'MD' => 'Maryland', 'MA' => 'Massachusetts', 'MI' => 'Michigan', 'MN' => 'Minnesota', 'MS' => 'Mississippi',
		'MO' => 'Missouri', 'MT' => 'Montana', 'NE' => 'Nebraska', 'NV' => 'Nevada', 'NH' => 'New Hampshire', 'NJ' => 'New Jersey',
		'NM' => 'New Mexico', 'NY' => 'New York', 'NC' => 'North Carolina', 'ND' => 'North Dakota', 'OH' => 'Ohio', 'OK' => 'Oklahoma',
		'OR' => 'Oregon', 'PA' => 'Pennsylvania', 'RI' => 'Rhode Island', 'SC' => 'South Carolina', 'SD' => 'South Dakota',
		'TN' => 'Tennessee', 'TX' => 'Texas', 'UT' => 'Utah', 'VT' => 'Vermont', 'VA' => 'Virginia', 'WA' => 'Washington',
		'WV' => 'West Virginia', 'WI' => 'Wisconsin', 'WY' => 'Wyoming', 'DC' => 'District of Columbia',
	);
}

/** Notes printed under each state's table (and above it, for "before"), as on the old page. */
function sas_county_state_notes() {
	$c = 'Checked October 2026.';
	return array(
		'AL' => array( 'Source: Alabama Emergency Management Agency. ' . $c ),
		'AR' => array( 'Source: Arkansas Division of Emergency Management. ' . $c ),
		'FL' => array( 'Source: Florida Division of Emergency Management and county websites. ' . $c, 'before' => 'Director names come from the state’s most recent readable list and may have changed; the phone numbers reach the county office.' ),
		'GA' => array( 'Source: Georgia Emergency Management and Homeland Security Agency. ' . $c ),
		'IL' => array( 'Source: Illinois Emergency Management Agency and Office of Homeland Security. ' . $c ),
		'IN' => array( 'Source: Indiana Department of Homeland Security. ' . $c ),
		'IA' => array( 'Source: Iowa Homeland Security and Emergency Management. ' . $c ),
		'KS' => array( 'Source: Kansas Division of Emergency Management. ' . $c ),
		'KY' => array( 'Source: County government websites. ' . $c ),
		'LA' => array( "Source: Governor's Office of Homeland Security and Emergency Preparedness. " . $c ),
		'MI' => array( 'Source: Michigan State Police Emergency Management and Homeland Security Division. ' . $c ),
		'MN' => array( 'Source: Minnesota Homeland Security and Emergency Management. ' . $c ),
		'MS' => array( 'Source: Mississippi Emergency Management Agency. ' . $c ),
		'MO' => array( 'Source: Missouri State Emergency Management Agency. ' . $c ),
		'NE' => array( 'Source: Nebraska Emergency Management Agency. ' . $c ),
		'ND' => array( 'Source: North Dakota Department of Emergency Services. ' . $c ),
		'OH' => array( 'Source: Ohio Emergency Management Agency. ' . $c ),
		'OK' => array( 'Source: Oklahoma Department of Emergency Management. ' . $c ),
		'SD' => array( 'Source: South Dakota LEPC contact list and county websites. ' . $c ),
		'TN' => array( 'Source: Tennessee Emergency Management Agency. ' . $c ),
		'TX' => array( 'Source: County government websites and regional councils. ' . $c ),
		'WI' => array( 'Source: County government websites. ' . $c ),
	);
}

/** tel: link target for a US number, ignoring any extension. */
function sas_county_tel( $phone ) {
	$main   = preg_split( '/\s*(x|ext\.?|extension)\s*\d/i', $phone )[0];
	$digits = preg_replace( '/\D/', '', $main );
	if ( 10 === strlen( $digits ) ) {
		return '+1' . $digits;
	}
	if ( 11 === strlen( $digits ) && '1' === $digits[0] ) {
		return '+' . $digits;
	}
	return $digits;
}

/** Show the agency under the county name only when it isn't the usual "X County EMA" kind of name. */
function sas_county_agency_note( $agency ) {
	return '' !== $agency && ( preg_match( '/shared/i', $agency ) || ( false !== strpos( $agency, '/' ) && ! preg_match( '/LEPC$/', $agency ) ) );
}

function sas_county_row_html( $r, $state, $edit_url ) {
	$e   = function ( $s ) {
		return esc_html( (string) $s );
	};
	$a   = function ( $s ) {
		return esc_attr( (string) $s );
	};
	$v   = array();
	foreach ( array( 'county', 'agency', 'director', 'phone', 'email', 'address', 'website' ) as $k ) {
		$v[ $k ] = isset( $r[ $k ] ) ? trim( (string) $r[ $k ] ) : '';
	}
	$kind = 'LA' === $state ? 'Parish' : 'County';
	$h    = '<tr data-c="' . $a( $v['county'] ) . '" data-a="' . $a( $v['agency'] ) . '"><td class="c">' . $e( $v['county'] . ' ' . $kind );
	if ( sas_county_agency_note( $v['agency'] ) ) {
		$h .= '<small>' . $e( $v['agency'] ) . '</small>';
	}
	$h .= '</td>';
	$web = '' !== $v['website'] ? '<a href="' . esc_url( $v['website'] ) . '" target="_blank" rel="noopener nofollow">Website</a>' : '';
	if ( '' === $v['director'] && '' === $v['phone'] && '' === $v['email'] && '' === $v['address'] ) {
		$h .= '<td colspan="4" class="na">Not listed yet — contact the county government' . ( $web ? ' via its website' : '' ) . '. Know the right contact? Use Suggest an Edit.</td>';
	} else {
		$h .= '<td data-l="Director">' . $e( $v['director'] ) . '</td>';
		$h .= '<td class="p" data-l="Phone">' . ( '' !== $v['phone'] ? '<a href="tel:' . $a( sas_county_tel( $v['phone'] ) ) . '">' . $e( $v['phone'] ) . '</a>' : '' ) . '</td>';
		$h .= '<td class="m" data-l="Email">' . ( '' !== $v['email'] ? '<a href="mailto:' . $a( $v['email'] ) . '">' . $e( $v['email'] ) . '</a>' : '' ) . '</td>';
		$h .= '<td data-l="Address">' . $e( $v['address'] ) . '</td>';
	}
	$h .= '<td class="w">' . $web . '</td>';
	if ( '' !== $edit_url ) {
		$h .= '<td class="e"><a class="fb" href="' . esc_attr( $edit_url ) . '">Suggest an Edit</a></td>';
	}
	return $h . '</tr>';
}

add_shortcode(
	'sas_county_contacts',
	function ( $atts ) {
		$atts = shortcode_atts( array( 'edit_url' => 'edit/' ), $atts, 'sas_county_contacts' );
		$edit = trim( html_entity_decode( (string) $atts['edit_url'] ) );
		if ( sas_county_in_editor() ) {
			// Page builders render shortcodes inside the editor; the full list (2,000+ rows) makes
			// Visual Composer hang, so the editor gets a small placeholder and visitors the list.
			return '<div style="padding:16px;border:1px dashed #999;font:15px/1.4 sans-serif;color:#444">County EM contacts list ([sas_county_contacts]). Visitors see the full list from Supabase here.</div>';
		}
		$rows = sas_county_contacts_all();
		if ( is_wp_error( $rows ) ) {
			return '<p>County contacts are not available right now. Please try again later.</p>';
		}
		$names = sas_county_state_names();
		$notes = sas_county_state_notes();
		$by    = array();
		foreach ( $rows as $r ) {
			$st = strtoupper( (string) $r['state'] );
			if ( '' !== trim( (string) $r['county'] ) ) {
				$by[ $st ][] = $r;
			}
		}
		uksort(
			$by,
			function ( $x, $y ) use ( $names ) {
				return strcasecmp( isset( $names[ $x ] ) ? $names[ $x ] : $x, isset( $names[ $y ] ) ? $names[ $y ] : $y );
			}
		);

		$base = plugin_dir_url( __DIR__ );
		wp_enqueue_style( 'sas-county', $base . 'assets/county.css', array(), SAS_REVIEW_VERSION );
		wp_enqueue_script( 'sas-county', $base . 'assets/county.js', array(), SAS_REVIEW_VERSION, true );

		$opts  = '';
		$links = '';
		$body  = '';
		foreach ( $by as $st => $list ) {
			usort(
				$list,
				function ( $x, $y ) {
					return strcasecmp( $x['county'], $y['county'] );
				}
			);
			$name   = isset( $names[ $st ] ) ? $names[ $st ] : $st;
			$lc     = strtolower( $st );
			$opts  .= '<option value="' . esc_attr( $lc ) . '">' . esc_html( $name ) . '</option>';
			$links .= '<li><a href="#em-' . esc_attr( $lc ) . '">' . esc_html( $name ) . '</a></li>';
			$n      = count( $list );
			$unit   = 'LA' === $st ? ( 1 === $n ? 'parish' : 'parishes' ) : ( 1 === $n ? 'county' : 'counties' );
			$body  .= '<details id="em-' . esc_attr( $lc ) . '" data-st="' . esc_attr( $lc ) . '"><summary>' . esc_html( $name ) . ' <span>(' . $n . ' ' . $unit . ')</span></summary><div class="sas-em-wrap">' . "\n";
			if ( ! empty( $notes[ $st ]['before'] ) ) {
				$body .= '<p class="sas-em-src">' . esc_html( $notes[ $st ]['before'] ) . '</p>';
			}
			$body .= '<table><thead><tr><th>County</th><th>Director / Coordinator</th><th>Phone</th><th>Email</th><th>Office Address</th><th>Website</th>' . ( '' !== $edit ? '<th>Corrections</th>' : '' ) . '</tr></thead><tbody>' . "\n";
			foreach ( $list as $r ) {
				$body .= sas_county_row_html( $r, $st, $edit ) . "\n";
			}
			$body .= '</tbody></table>';
			if ( ! empty( $notes[ $st ][0] ) ) {
				$body .= '<p class="sas-em-src">' . esc_html( $notes[ $st ][0] ) . '</p>';
			}
			$body .= '</div></details>' . "\n";
		}

		return '<div class="sas-em">' . "\n"
			. '<div class="sas-em-tools"><label for="sas-em-q" style="position:absolute;left:-9999px">Search counties</label><input id="sas-em-q" type="search" placeholder="Search county, city or name…" autocomplete="off"><label for="sas-em-st" style="position:absolute;left:-9999px">Choose a state</label><select id="sas-em-st"><option value="">All states</option>' . $opts . '</select></div>' . "\n"
			. '<ul class="sas-em-states">' . $links . '</ul>' . "\n"
			. $body
			. '</div>';
	}
);
