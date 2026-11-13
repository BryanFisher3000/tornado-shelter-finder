<?php
/**
 * Sign-in for the website's shelter forms, with the same accounts as the app.
 *
 * In the app, adding a shelter or suggesting an edit needs a signed-in account. The website's shelter
 * forms now ask for the same: assets/shelter-account.js shows the app's sign-in (Google, Apple,
 * Facebook, email) in front of the form and sends the account's access token with it, as the form
 * value sas_account_token. Here that token is checked with Supabase before the entry is accepted, so
 * nobody can send a shelter form without an account, and the review queue gets the person's real
 * name, email and account id instead of whatever was typed. The token is never stored.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'SAS_SUPABASE_PUBLISHABLE_KEY' ) ) {
	// The app's public key, the same one that is in the app's own page. It only lets a browser talk
	// to Supabase's sign-in; it opens no data. (The secret key stays in wp-config.php.)
	define( 'SAS_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_jKaaBPri_pJorALxmh4Ndg_LClnGIZk' );
}

/** True while the website's shelter forms need a signed-in account (return false from the filter to switch it off). */
function sas_account_required() {
	return (bool) apply_filters( 'sas_forms_require_signin', true );
}

/** The form fields that hold the sender's name and email, by field key: filled from the account. */
function sas_account_info_keys() {
	return array(
		'sfb_first' => 'first',
		'sfb_last'  => 'last',
		'sfb_email' => 'email',
		'1imzl'     => 'first',
		'sof1r'     => 'last',
		'k5ihj'     => 'email',
	);
}

/** True for the website's shelter forms (Suggest an Edit and Add a Shelter), told by their field keys. */
function sas_account_is_shelter_form( $form_id ) {
	static $known = array();
	$form_id = (int) $form_id;
	if ( isset( $known[ $form_id ] ) ) {
		return $known[ $form_id ];
	}
	$is = false;
	if ( $form_id && class_exists( 'FrmField' ) ) {
		$add = array_flip( sas_forms_add_keys() );
		foreach ( FrmField::get_all_for_form( $form_id ) as $f ) {
			$key = isset( $f->field_key ) ? (string) $f->field_key : '';
			if ( 'sfb_name' === $key || 'sfb_orig_name' === $key || isset( $add[ $key ] ) ) {
				$is = true;
				break;
			}
		}
	}
	$known[ $form_id ] = $is;
	return $is;
}

/**
 * The account behind the form being sent: array( id, email, first, last, phone, provider ), or a
 * WP_Error whose message can be shown to the person. Asked of Supabase once per token.
 */
function sas_account_current() {
	$token = isset( $_POST['sas_account_token'] ) ? trim( (string) wp_unslash( $_POST['sas_account_token'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
	if ( ! isset( $GLOBALS['sas_account_checked'] ) || ! is_array( $GLOBALS['sas_account_checked'] ) ) {
		$GLOBALS['sas_account_checked'] = array();
	}
	$slot = md5( $token );
	if ( ! isset( $GLOBALS['sas_account_checked'][ $slot ] ) ) {
		$GLOBALS['sas_account_checked'][ $slot ] = sas_account_check( $token );
	}
	return $GLOBALS['sas_account_checked'][ $slot ];
}

function sas_account_check( $token ) {
	if ( '' === $token ) {
		return new WP_Error( 'sas_account_missing', 'Please sign in to send this form.' );
	}
	$expired = 'Your sign-in has run out. Please sign in again, then send the form once more.';
	if ( strlen( $token ) > 8192 || ! preg_match( '/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/D', $token ) ) {
		return new WP_Error( 'sas_account_rejected', $expired );
	}
	$res = wp_remote_get(
		rtrim( SAS_SUPABASE_URL, '/' ) . '/auth/v1/user',
		array(
			'timeout' => 10,
			'headers' => array(
				'apikey'        => SAS_SUPABASE_PUBLISHABLE_KEY,
				'Authorization' => 'Bearer ' . $token,
				'Accept'        => 'application/json',
			),
		)
	);
	$later = 'We could not check your sign-in just now. Please try again in a moment.';
	if ( is_wp_error( $res ) ) {
		return new WP_Error( 'sas_account_unreachable', $later );
	}
	$code = (int) wp_remote_retrieve_response_code( $res );
	$user = json_decode( (string) wp_remote_retrieve_body( $res ), true );
	if ( $code >= 500 || 429 === $code ) {
		return new WP_Error( 'sas_account_unreachable', $later );
	}
	if ( 200 !== $code || ! is_array( $user ) || empty( $user['id'] ) || ! preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iD', (string) $user['id'] ) ) {
		return new WP_Error( 'sas_account_rejected', $expired );
	}

	// My Details, as the app reads them: the profile row first, then what the sign-in provider passed on.
	$id   = strtolower( (string) $user['id'] );
	$meta = isset( $user['user_metadata'] ) && is_array( $user['user_metadata'] ) ? $user['user_metadata'] : array();
	$m    = function ( $k ) use ( $meta ) {
		return isset( $meta[ $k ] ) && is_scalar( $meta[ $k ] ) ? trim( (string) $meta[ $k ] ) : '';
	};
	$row  = array();
	$rows = sas_review_supabase( 'GET', 'profiles?select=first_name,last_name,email,phone&id=eq.' . $id . '&limit=1' );
	if ( ! is_wp_error( $rows ) && is_array( $rows ) && ! empty( $rows[0] ) && is_array( $rows[0] ) ) {
		$row = $rows[0];
	}
	$r     = function ( $k ) use ( $row ) {
		return isset( $row[ $k ] ) && is_scalar( $row[ $k ] ) ? trim( (string) $row[ $k ] ) : '';
	};
	$full  = '' !== $m( 'full_name' ) ? $m( 'full_name' ) : $m( 'name' );
	$parts = '' !== $full ? preg_split( '/\s+/', $full, 2 ) : array();
	$pick  = function () {
		foreach ( func_get_args() as $v ) {
			if ( '' !== $v ) {
				return $v;
			}
		}
		return '';
	};
	$app   = isset( $user['app_metadata'] ) && is_array( $user['app_metadata'] ) && isset( $user['app_metadata']['provider'] ) ? (string) $user['app_metadata']['provider'] : '';
	return array(
		'id'       => $id,
		'email'    => sanitize_email( $pick( $r( 'email' ), isset( $user['email'] ) ? trim( (string) $user['email'] ) : '', $m( 'email' ) ) ),
		'first'    => sanitize_text_field( $pick( $r( 'first_name' ), $m( 'first_name' ), $m( 'given_name' ), isset( $parts[0] ) ? $parts[0] : '' ) ),
		'last'     => sanitize_text_field( $pick( $r( 'last_name' ), $m( 'last_name' ), $m( 'family_name' ), isset( $parts[1] ) ? $parts[1] : '' ) ),
		'phone'    => sanitize_text_field( $r( 'phone' ) ),
		'provider' => preg_replace( '/[^a-z0-9_-]/', '', strtolower( $app ) ),
	);
}

/** The account as the review queue keeps a sender: the same shape the app sends. */
function sas_account_submitter( $acct ) {
	return array(
		'first_name'    => $acct['first'],
		'last_name'     => $acct['last'],
		'email'         => $acct['email'],
		'phone'         => '' !== $acct['phone'] ? $acct['phone'] : null,
		'auth_provider' => '' !== $acct['provider'] ? $acct['provider'] : null,
		'user_id'       => $acct['id'],
	);
}

/**
 * True when this request is someone sending a shelter form from the website. Staff typing an entry in the
 * WordPress dashboard are not asked: that is a dashboard page (not WordPress's background address, which the
 * website's forms may use), opened by someone signed in to WordPress who may review or add Formidable entries.
 */
function sas_account_applies( $form_id ) {
	if ( ! sas_account_required() || ! sas_account_is_shelter_form( $form_id ) ) {
		return false;
	}
	$staff = is_admin() && ! wp_doing_ajax() && is_user_logged_in()
		&& ( sas_review_can_review() || current_user_can( 'frm_create_entries' ) );
	return ! $staff;
}

// No account, no entry: Formidable shows the message with the form.
add_filter( 'frm_validate_entry', 'sas_account_validate', 20, 2 );
function sas_account_validate( $errors, $values ) {
	$form_id = is_array( $values ) && isset( $values['form_id'] ) ? (int) $values['form_id'] : 0;
	if ( ! $form_id || ! sas_account_applies( $form_id ) ) {
		return $errors;
	}
	$acct = sas_account_current();
	if ( is_wp_error( $acct ) ) {
		if ( ! is_array( $errors ) ) {
			$errors = array();
		}
		// (the error's own code is its key, so the page can tell a sign-in that ran out from one that could not be checked)
		$errors[ $acct->get_error_code() ] = $acct->get_error_message();
		$GLOBALS['sas_account_said']       = array(
			'code' => $acct->get_error_code(),
			'text' => $acct->get_error_message(),
		);
	}
	return $errors;
}

// The entry Formidable keeps (and any email it sends) carries the account's name and email, not typed ones.
add_filter( 'frm_pre_create_entry', 'sas_account_fill_entry', 20 );
function sas_account_fill_entry( $values ) {
	$form_id = is_array( $values ) && isset( $values['form_id'] ) ? (int) $values['form_id'] : 0;
	if ( ! $form_id || ! sas_account_applies( $form_id ) || ! class_exists( 'FrmField' ) ) {
		return $values;
	}
	$acct = sas_account_current();
	if ( is_wp_error( $acct ) ) {
		return $values;
	}
	$keys = sas_account_info_keys();
	foreach ( FrmField::get_all_for_form( $form_id ) as $f ) {
		$key = isset( $f->field_key ) ? (string) $f->field_key : '';
		if ( isset( $keys[ $key ] ) && isset( $f->id ) ) {
			if ( ! isset( $values['item_meta'] ) || ! is_array( $values['item_meta'] ) ) {
				$values['item_meta'] = array();
			}
			$values['item_meta'][ $f->id ] = $acct[ $keys[ $key ] ];
		}
	}
	return $values;
}
