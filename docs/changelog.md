# Changelog

This file provides a running tally of breaking changes.
It is not meant to be exhaustive — if you notice a breaking change that is not included in this list, please [open an issue](https://github.com/julianlam/NodeBB-plugin-2factor/issues/new) and let me know.

## v7.x

* If an account is protected by Two-Factor Authentication, you will still be considered a guest when the page is loaded  — specifically, `app.user` is no longer showing logged-in user data.
* Requests to the API (both the Read and Write API) now return a standard API-style (an object with `status` and `payload`) `401 Unauthorized` error if you have not passed the 2FA check.

## v6.x

* The plugin was updated to support a minimum NodeBB version of v3.x.
    * The plugin should still work under v2.x, but the UI may not look as polished as the front-end elements have been changed to use Bootstrap 5 class names.

## v5.x

* Users are now presented with a list of choices based on configured 2FA methods, instead of a priority-based challenge
* Users can now set up multiple 2FA methods (e.g. both TOTP and Hardware key at the same time.)