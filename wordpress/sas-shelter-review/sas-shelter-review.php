<?php
/**
 * Plugin Name: SAS Shelter Review
 * Description: Review dashboard for Tornado Shelter Finder submissions. Add the [sas_shelter_review] shortcode to a page; signed-in Editors and Administrators can review, approve and reject submissions from the app and website.
 * Version: 1.0.0
 * Author: Survive-A-Storm
 * Requires at least: 5.8
 * Requires PHP: 7.4
 *
 * Setup: add the Supabase secret key to wp-config.php (above "That's all, stop editing!"):
 *   define( 'SAS_SUPABASE_SECRET_KEY', 'sb_secret_...' );
 * The key stays on the server. The page only talks to this site's REST API, which checks the
 * WordPress login on every request before it calls Supabase.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SAS_REVIEW_VERSION', '1.0.0' );
if ( ! defined( 'SAS_SUPABASE_URL' ) ) {
	define( 'SAS_SUPABASE_URL', 'https://svptjcclszprsmjoldaz.supabase.co' );
}

/** Who may review: Editors and above by default (they can edit other people's posts). */
function sas_review_can_review() {
	$cap = apply_filters( 'sas_review_capability', 'edit_others_posts' );
	return is_user_logged_in() && current_user_can( $cap );
}

function sas_review_reviewer_name() {
	$u = wp_get_current_user();
	return trim( $u->display_name ) !== '' ? $u->display_name . ' (' . $u->user_login . ')' : $u->user_login;
}

/** Call Supabase's REST API with the secret key. Returns array( status, decoded body ) or WP_Error. */
function sas_review_supabase( $method, $path, $body = null, $extra_headers = array() ) {
	if ( ! defined( 'SAS_SUPABASE_SECRET_KEY' ) || ! SAS_SUPABASE_SECRET_KEY ) {
		return new WP_Error( 'sas_no_key', 'The Supabase secret key is not set. Add SAS_SUPABASE_SECRET_KEY to wp-config.php.', array( 'status' => 500 ) );
	}
	$key     = SAS_SUPABASE_SECRET_KEY;
	$headers = array_merge(
		array(
			'apikey'       => $key,
			'Content-Type' => 'application/json',
			'Accept'       => 'application/json',
		),
		$extra_headers
	);
	// Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys don't.
	if ( 0 === strpos( $key, 'eyJ' ) ) {
		$headers['Authorization'] = 'Bearer ' . $key;
	}
	$args = array(
		'method'  => $method,
		'headers' => $headers,
		'timeout' => 20,
	);
	if ( null !== $body ) {
		$args['body'] = wp_json_encode( $body );
	}
	$res = wp_remote_request( rtrim( SAS_SUPABASE_URL, '/' ) . '/rest/v1/' . $path, $args );
	if ( is_wp_error( $res ) ) {
		return new WP_Error( 'sas_supabase', 'Could not reach Supabase: ' . $res->get_error_message(), array( 'status' => 502 ) );
	}
	$code = wp_remote_retrieve_response_code( $res );
	$data = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( $code >= 400 ) {
		$msg = is_array( $data ) && isset( $data['message'] ) ? $data['message'] : 'HTTP ' . $code;
		return new WP_Error( 'sas_supabase', 'Supabase error: ' . $msg, array( 'status' => 502 ) );
	}
	return $data;
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'sas/v1',
			'/submissions',
			array(
				'methods'             => 'GET',
				'permission_callback' => 'sas_review_can_review',
				'callback'            => function () {
					$rows = sas_review_supabase( 'GET', 'submissions?select=*&order=created_at.desc&limit=1000' );
					if ( is_wp_error( $rows ) ) {
						return $rows;
					}
					return rest_ensure_response( array( 'submissions' => $rows, 'me' => sas_review_reviewer_name() ) );
				},
			)
		);
		register_rest_route(
			'sas/v1',
			'/submissions/(?P<id>\d+)',
			array(
				'methods'             => 'POST',
				'permission_callback' => 'sas_review_can_review',
				'args'                => array(
					'action' => array(
						'required' => true,
						'enum'     => array( 'claim', 'takeover', 'approve', 'reject', 'request_info', 'reopen' ),
					),
					'note'   => array( 'type' => 'string', 'default' => '' ),
					'reason' => array(
						'type'    => 'string',
						'default' => '',
						'enum'    => array( '', 'spam', 'wrong', 'duplicate', 'unverifiable', 'other' ),
					),
				),
				'callback'            => 'sas_review_decide',
			)
		);
	}
);

/**
 * Apply one review action. The page can only pick an action, a reason and a note; the status,
 * reviewer and time are set here, so a reviewer can't write anything else into the row.
 */
function sas_review_decide( WP_REST_Request $req ) {
	$id     = (int) $req['id'];
	$action = $req['action'];
	$note   = trim( sanitize_textarea_field( $req['note'] ) );
	$reason = $req['reason'];
	$now    = gmdate( 'c' );
	$me     = sas_review_reviewer_name();

	$filter = 'id=eq.' . $id;
	switch ( $action ) {
		case 'claim': // only an unclaimed item, so two reviewers don't both claim it
			$patch   = array( 'status' => 'in_review', 'reviewed_by' => $me, 'reviewed_at' => $now );
			$filter .= '&status=eq.pending';
			break;
		case 'takeover':
		case 'reopen':
			$patch = array( 'status' => 'in_review', 'reviewed_by' => $me, 'reviewed_at' => $now );
			break;
		case 'approve':
			$patch = array( 'status' => 'approved', 'reviewed_by' => $me, 'reviewed_at' => $now, 'reviewer_note' => '' !== $note ? $note : null );
			break;
		case 'request_info':
			if ( '' === $note ) {
				return new WP_Error( 'sas_note', 'Write the question first.', array( 'status' => 400 ) );
			}
			$patch = array( 'status' => 'needs_info', 'reviewed_by' => $me, 'reviewed_at' => $now, 'reviewer_note' => $note );
			break;
		case 'reject':
			if ( '' === $reason ) {
				return new WP_Error( 'sas_reason', 'Choose a reason.', array( 'status' => 400 ) );
			}
			$patch = array( 'status' => 'rejected', 'reviewed_by' => $me, 'reviewed_at' => $now, 'reviewer_note' => trim( '[' . $reason . '] ' . $note ) );
			break;
		default:
			return new WP_Error( 'sas_action', 'Unknown action.', array( 'status' => 400 ) );
	}
	if ( 'claim' !== $action && 'reopen' !== $action ) {
		// a decision only applies to an open item
		$filter .= '&status=in.(pending,in_review,needs_info,superseded)';
	}
	$rows = sas_review_supabase( 'PATCH', 'submissions?' . $filter, $patch, array( 'Prefer' => 'return=representation' ) );
	if ( is_wp_error( $rows ) ) {
		return $rows;
	}
	if ( empty( $rows ) ) {
		if ( 'claim' === $action ) {
			return rest_ensure_response( array( 'submission' => null ) ); // someone else got there first
		}
		return new WP_Error( 'sas_stale', 'This submission was already decided. Refresh to see the latest.', array( 'status' => 409 ) );
	}
	return rest_ensure_response( array( 'submission' => $rows[0] ) );
}

add_shortcode(
	'sas_shelter_review',
	function ( $atts ) {
		$atts = shortcode_atts(
			array( 'shelters_url' => 'https://raw.githubusercontent.com/BryanFisher3000/tornado-shelter-finder/main/website/data/shelters.json' ),
			$atts,
			'sas_shelter_review'
		);
		if ( ! is_user_logged_in() ) {
			return '<div class="sas-review-gate"><p>Sign in to WordPress as an Editor or Administrator to review shelter submissions.</p><p><a href="' . esc_url( wp_login_url( get_permalink() ) ) . '">Sign in</a></p></div>';
		}
		if ( ! sas_review_can_review() ) {
			return '<div class="sas-review-gate"><p>Your WordPress account can\'t review submissions. Ask an administrator to make you an Editor.</p></div>';
		}
		$base = plugin_dir_url( __FILE__ );
		wp_enqueue_style( 'sas-review-fonts', 'https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap', array(), null );
		wp_enqueue_style( 'sas-review', $base . 'assets/review.css', array(), SAS_REVIEW_VERSION );
		wp_enqueue_script( 'sas-review', $base . 'assets/review.js', array(), SAS_REVIEW_VERSION, true );
		wp_localize_script(
			'sas-review',
			'SAS_REVIEW',
			array(
				'api'         => esc_url_raw( rest_url( 'sas/v1/' ) ),
				'nonce'       => wp_create_nonce( 'wp_rest' ),
				'me'          => sas_review_reviewer_name(),
				'sheltersUrl' => esc_url_raw( $atts['shelters_url'] ),
				'keySet'      => defined( 'SAS_SUPABASE_SECRET_KEY' ) && SAS_SUPABASE_SECRET_KEY,
			)
		);
		ob_start();
		include __DIR__ . '/assets/review-markup.php';
		return ob_get_clean();
	}
);

function sas_review_is_review_page() {
	return is_singular() && has_shortcode( (string) get_post_field( 'post_content', get_queried_object_id() ), 'sas_shelter_review' );
}

// Keep the review page out of caches and search results; it shows people's contact details.
add_action(
	'template_redirect',
	function () {
		if ( sas_review_is_review_page() ) {
			nocache_headers();
			header( 'X-Robots-Tag: noindex, nofollow', true );
		}
	}
);
add_action(
	'wp_head',
	function () {
		if ( sas_review_is_review_page() ) {
			echo '<meta name="robots" content="noindex, nofollow">' . "\n";
		}
	}
);
