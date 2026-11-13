<?php
/**
 * The website's shelter forms, like the app's, behind the app's sign-in.
 *
 * On the finder page and on its "Suggest an Edit" page this loads assets/shelter-forms.js and
 * assets/shelter-forms.css. The script redraws the Formidable forms there (39 "Add/Edit Shelter"
 * and 44 "Suggest an Edit") as the app's Add a Shelter and Suggest an Edit forms. The Formidable
 * fields stay in the page and carry the answers, so the spam check, the stored entry and the
 * review queue (formidable.php) work as before.
 *
 * The Add a Shelter page has a Formidable form made for it (form key sas_add_shelter, imported
 * from wordpress/forms/add-a-shelter-form.xml), with a field for each of the app's. That form is
 * shown as Formidable writes it; the script only adds what a form builder has no field for: the
 * map for placing the pin (Leaflet, in assets/vendor, fetched when the form shows) and the
 * address lookup that moves that map.
 *
 * It also loads assets/shelter-account.js, which shows the app's sign-in in front of each shelter
 * form (see account.php). That script fetches assets/vendor/supabase.js, the Supabase library the
 * app uses, only when a shelter form is on the page. No other page loads any of these files.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** True on the pages that carry the shelter forms (by page id, or by address if the ids ever change). */
function sas_forms_is_form_page() {
	global $wp;
	if ( is_page( apply_filters( 'sas_shelter_forms_page_ids', array( 73443, 907809 ) ) ) ) {
		return true;
	}
	$path = is_object( $wp ) && isset( $wp->request ) ? strtolower( trim( (string) $wp->request, '/' ) ) : '';
	return in_array( $path, apply_filters( 'sas_shelter_forms_paths', array( 'tornado-shelter-finder', 'tornado-shelter-finder/edit', 'tornado-shelter-finder/add' ) ), true );
}

/**
 * True while the page is open in a page editor: Visual Composer, which would save a redrawn form
 * into the page, or Bricks, where the form should look the way the form builder made it.
 */
function sas_forms_in_editor() {
	if ( is_admin() || isset( $_GET['vcv-editable'] ) || isset( $_GET['vcv-action'] ) || isset( $_GET['bricks'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return true;
	}
	// (Bricks also draws a page's elements in background requests while it is being edited)
	return ( function_exists( 'bricks_is_builder' ) && bricks_is_builder() ) || ( function_exists( 'bricks_is_builder_call' ) && bricks_is_builder_call() );
}

/**
 * What the sign-in script needs: where Supabase is, the app's public key, and where the library is.
 * When a form has just come back because its sign-in was not accepted, also what the server said (said).
 */
function sas_forms_account_config() {
	$config = array(
		'url' => rtrim( SAS_SUPABASE_URL, '/' ),
		'key' => SAS_SUPABASE_PUBLISHABLE_KEY,
		'lib' => plugin_dir_url( __DIR__ ) . 'assets/vendor/supabase.js?ver=2.119.0',
	);
	if ( ! empty( $GLOBALS['sas_account_said'] ) && is_array( $GLOBALS['sas_account_said'] ) ) {
		$config['said'] = $GLOBALS['sas_account_said'];
	}
	return $config;
}

/**
 * What the forms script needs for the Add a Shelter page's map: where Leaflet is. With
 * define( 'SAS_GOOGLE_MAPS_KEY', '...' ) in wp-config.php it also gets that key, and offers Google's
 * address suggestions on that page (the finder page already has Google Maps of its own).
 */
function sas_forms_page_config() {
	$vendor = plugin_dir_url( __DIR__ ) . 'assets/vendor/';
	$config = array(
		'leaflet' => array(
			'js'  => $vendor . 'leaflet.js?ver=1.9.4',
			'css' => $vendor . 'leaflet.css?ver=1.9.4',
		),
	);
	if ( defined( 'SAS_GOOGLE_MAPS_KEY' ) && is_string( SAS_GOOGLE_MAPS_KEY ) && '' !== SAS_GOOGLE_MAPS_KEY ) {
		$config['mapsKey'] = SAS_GOOGLE_MAPS_KEY;
	}
	return $config;
}

function sas_forms_enqueue() {
	static $done = false;
	if ( $done ) {
		return;
	}
	$done = true;
	$base = plugin_dir_url( __DIR__ );
	$deps = array();
	wp_enqueue_style( 'sas-shelter-forms', $base . 'assets/shelter-forms.css', array(), SAS_REVIEW_VERSION );
	if ( sas_account_required() ) {
		wp_enqueue_script( 'sas-shelter-account', $base . 'assets/shelter-account.js', array(), SAS_REVIEW_VERSION, true );
		wp_add_inline_script( 'sas-shelter-account', 'window.sasShelterAccountConfig = ' . wp_json_encode( sas_forms_account_config() ) . ';', 'before' );
		$deps[] = 'sas-shelter-account';
	}
	wp_enqueue_script( 'sas-shelter-forms', $base . 'assets/shelter-forms.js', $deps, SAS_REVIEW_VERSION, true );
	wp_add_inline_script( 'sas-shelter-forms', 'window.sasShelterFormsConfig = ' . wp_json_encode( sas_forms_page_config() ) . ';', 'before' );
}

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! sas_forms_in_editor() && sas_forms_is_form_page() ) {
			sas_forms_enqueue();
		}
	}
);

// A shelter form shown on any other page (Formidable runs this as it writes a form out) gets the same files.
add_action(
	'frm_entry_form',
	function ( $form ) {
		$key = is_object( $form ) && isset( $form->form_key ) ? (string) $form->form_key : '';
		if ( ! sas_forms_in_editor() && in_array( $key, apply_filters( 'sas_shelter_forms_keys', array( 'shelter-feedback', 'add-edit-tornado-shelter', 'sas_add_shelter' ) ), true ) ) {
			sas_forms_enqueue();
		}
	}
);
