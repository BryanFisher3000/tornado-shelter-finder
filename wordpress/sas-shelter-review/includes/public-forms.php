<?php
/**
 * The website's two shelter forms, drawn like the app's.
 *
 * On the finder page and on its "Suggest an Edit" page this loads assets/shelter-forms.js and
 * assets/shelter-forms.css. The script redraws the Formidable forms there (39 "Add/Edit Shelter"
 * and 44 "Suggest an Edit") as the app's Add a Shelter and Suggest an Edit forms. The Formidable
 * fields stay in the page and carry the answers, so the spam check, the stored entry and the
 * review queue (formidable.php) work as before. No other page loads these two files.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** True on the two pages that carry the shelter forms (by page id, or by address if the ids ever change). */
function sas_forms_is_form_page() {
	global $wp;
	if ( is_page( apply_filters( 'sas_shelter_forms_page_ids', array( 73443, 907809 ) ) ) ) {
		return true;
	}
	$path = is_object( $wp ) && isset( $wp->request ) ? strtolower( trim( (string) $wp->request, '/' ) ) : '';
	return in_array( $path, apply_filters( 'sas_shelter_forms_paths', array( 'tornado-shelter-finder', 'tornado-shelter-finder/edit' ) ), true );
}

add_action(
	'wp_enqueue_scripts',
	function () {
		// Not while the page is open in the Visual Composer editor: it would save the redrawn form into the page.
		if ( is_admin() || isset( $_GET['vcv-editable'] ) || isset( $_GET['vcv-action'] ) || ! sas_forms_is_form_page() ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}
		$base = plugin_dir_url( __DIR__ );
		wp_enqueue_style( 'sas-shelter-forms', $base . 'assets/shelter-forms.css', array(), SAS_REVIEW_VERSION );
		wp_enqueue_script( 'sas-shelter-forms', $base . 'assets/shelter-forms.js', array(), SAS_REVIEW_VERSION, true );
	}
);
