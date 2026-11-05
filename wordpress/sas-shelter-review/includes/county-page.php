<?php
/**
 * Public county emergency management contacts page.
 * Shortcode: [sas_county_contacts]  (optional: state="TX" to open on one state;
 *   edit_url="/edit-county/?county={county}&state={state}" adds an Edit link to each county)
 * Reads public.county_contacts in Supabase on the server and caches it for an hour;
 * saving a county on the review page clears the cache, so edits show right away.
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

function sas_county_link( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return '';
	}
	if ( ! preg_match( '#^https?://#i', $url ) ) {
		$url = 'https://' . $url;
	}
	$label = preg_replace( '#^https?://(www\.)?#i', '', rtrim( $url, '/' ) );
	return '<a href="' . esc_url( $url ) . '" target="_blank" rel="noopener">' . esc_html( $label ) . '</a>';
}

add_shortcode(
	'sas_county_contacts',
	function ( $atts ) {
		$atts  = shortcode_atts( array( 'state' => '', 'edit_url' => '', 'edit_label' => 'Edit' ), $atts, 'sas_county_contacts' );
		$rows  = sas_county_contacts_all();
		if ( is_wp_error( $rows ) ) {
			return '<p>County contacts are not available right now. Please try again later.</p>';
		}
		$names  = sas_county_state_names();
		$states = array();
		foreach ( $rows as $r ) {
			$states[ $r['state'] ] = isset( $names[ $r['state'] ] ) ? $names[ $r['state'] ] : $r['state'];
		}
		asort( $states );
		$pick = strtoupper( sanitize_text_field( wp_unslash( isset( $_GET['state'] ) ? $_GET['state'] : $atts['state'] ) ) ); // phpcs:ignore WordPress.Security.NonceVerification
		if ( ! isset( $states[ $pick ] ) ) {
			$pick = '';
		}

		$base = plugin_dir_url( __DIR__ );
		wp_enqueue_style( 'sas-county', $base . 'assets/county.css', array(), SAS_REVIEW_VERSION );
		wp_enqueue_script( 'sas-county', $base . 'assets/county.js', array(), SAS_REVIEW_VERSION, true );

		ob_start();
		?>
		<div class="sas-county" id="sas-county">
			<form class="sas-county-bar" method="get">
				<label>State
					<select name="state" onchange="this.form.submit()">
						<option value="">Choose a state</option>
						<?php foreach ( $states as $code => $name ) : ?>
							<option value="<?php echo esc_attr( $code ); ?>" <?php selected( $pick, $code ); ?>><?php echo esc_html( $name ); ?></option>
						<?php endforeach; ?>
					</select>
				</label>
				<noscript><button type="submit">Show</button></noscript>
				<?php if ( $pick ) : ?>
					<label>County <input type="search" id="sas-county-q" placeholder="Type a county name" autocomplete="off"></label>
				<?php endif; ?>
			</form>
			<?php if ( ! $pick ) : ?>
				<p class="sas-county-note">Choose a state to see each county's emergency management office.</p>
			<?php else : ?>
				<div class="sas-county-list">
				<?php
				foreach ( $rows as $r ) :
					if ( $r['state'] !== $pick ) {
						continue;
					}
					$has = $r['agency'] || $r['phone'] || $r['email'] || $r['website'];
					?>
					<div class="sas-county-card" data-name="<?php echo esc_attr( strtolower( $r['county'] ) ); ?>">
						<h3><?php echo esc_html( $r['county'] ); ?></h3>
						<?php if ( ! $has ) : ?>
							<p class="sas-county-none">Contact details not listed yet.</p>
						<?php else : ?>
							<dl>
								<?php if ( $r['agency'] ) : ?><dt>Agency</dt><dd><?php echo esc_html( $r['agency'] ); ?></dd><?php endif; ?>
								<?php if ( $r['director'] ) : ?><dt>Director</dt><dd><?php echo esc_html( $r['director'] ); ?></dd><?php endif; ?>
								<?php if ( $r['phone'] ) : ?><dt>Phone</dt><dd><a href="tel:<?php echo esc_attr( preg_replace( '/[^0-9+]/', '', $r['phone'] ) ); ?>"><?php echo esc_html( $r['phone'] ); ?></a></dd><?php endif; ?>
								<?php if ( $r['email'] ) : ?><dt>Email</dt><dd><a href="mailto:<?php echo esc_attr( $r['email'] ); ?>"><?php echo esc_html( $r['email'] ); ?></a></dd><?php endif; ?>
								<?php if ( $r['website'] ) : ?><dt>Website</dt><dd><?php echo sas_county_link( $r['website'] ); // phpcs:ignore WordPress.Security.EscapeOutput ?></dd><?php endif; ?>
								<?php if ( $r['address'] ) : ?><dt>Address</dt><dd><?php echo esc_html( $r['address'] ); ?></dd><?php endif; ?>
							</dl>
						<?php endif; ?>
						<?php if ( $atts['edit_url'] ) : ?>
							<p class="sas-county-edit"><a href="<?php echo esc_url( strtr( $atts['edit_url'], array( '{county}' => rawurlencode( $r['county'] ), '{state}' => rawurlencode( $r['state'] ) ) ) ); ?>"><?php echo esc_html( $atts['edit_label'] ); ?></a></p>
						<?php endif; ?>
					</div>
				<?php endforeach; ?>
				</div>
				<p class="sas-county-empty" hidden>No county matches that name.</p>
			<?php endif; ?>
		</div>
		<?php
		return ob_get_clean();
	}
);
