# Two-Factor Authentication for NodeBB

In addition to regular authentication via username/password or SSO, a second layer of security can be configured, permitting access only if:

* A time-based one-time password is supplied, typically generated/stored on a mobile device, or
* A hardware token is activated, such as a [Yubikey](https://www.yubico.com/) or other similar product

The Two-Factor Authentication plugin will expose this feature to end-users, allowing them to configure their
devices and enabling this enhanced security on their account.

## Version History

* v3.x
    * Introduces hardware key support via [WebAuthn](https://en.wikipedia.org/wiki/WebAuthn).
	* This version is fully backwards compatible with v2.x. The major version bump was merely due to the introduction of the new functionality

## Caveats

* Due to browser limitations, the hardware key _on mobile devices_ (especially Android devices) may not be supported. For more information on which devices are and are not supported, [please consult this chart](https://webauthn.me/browser-support)

## Installation

Install the plugin via the ACP/Plugins page.

## Screenshots

![Token Generation Step](./screenshots/generate.png)

**Token Generation Step**

![Challenge Step](./screenshots/challenge.png)

**Challenge Step**