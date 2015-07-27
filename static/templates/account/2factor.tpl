<!-- IF showSetup -->
<div class="panel panel-default">
	<div class="panel-heading">
		<h3 class="panel-title">What is Two-Factor Authentication?</h3>
	</div>
	<div class="panel-body">
		<p>
			In addition to regular authentication via username/password or SSO, a second layer of security can be configured, permitting access only if
			a time-based one-time password is supplied, typically generated/stored on a mobile device.
		</p>
		<p>
			To enable Two-Factor Authentication, click the button below to generate a token for NodeBB.
			Once generated, scan it into your mobile device via the GAuthenticator (or another similar app).
			Lastly, confirm setup by entering the current time-based password into the confirmation screen.
		</p>
		<p>
			Once setup, login attempts will not proceed until both the password and one-time token is supplied.
		</p>
	</div>
</div>
<!-- ENDIF showSetup -->
<div class="panel panel-default">
	<div class="panel-heading">
		<!-- IF showSetup -->
		<span class="text-danger pull-right"><strong>Disabled</strong> <i class="fa fa-circle"></i></span>
		<!-- ELSE -->
		<span class="text-success pull-right"><strong>Enabled</strong> <i class="fa fa-circle"></i></span>
		<!-- ENDIF showSetup -->
		<h3 class="panel-title">Two-Factor Authentication Settings</h3>
	</div>
	<div class="panel-body">
		<!-- IF showSetup -->
		<p>
			<button class="btn btn-primary" data-action="regenerate">Enable Two-Factor Authentication</button>
		</p>
		<!-- ELSE -->
		<button class="btn btn-danger" data-action="disassociate">Disable Two-Factor Authentication</button>
		<!-- ENDIF showSetup -->
	</div>
</div>