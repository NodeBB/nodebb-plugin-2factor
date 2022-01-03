<div class="account">
	<!-- IMPORT partials/account/header.tpl -->

	<!-- IF showSetup -->
	<p class="lead">
		[[2factor:user.intro.one]]
	</p>
	<p>
		[[2factor:user.intro.two]]
	</p>
	<p>
		[[2factor:user.intro.three]]
	</p>

	<hr />
	<!-- ENDIF showSetup -->

	<!-- IF forceTfa -->
	<div class="alert alert-info">[[2factor:user.force_2fa]]</div>
	<!-- ENDIF forceTfa -->

	<h3>
		{{{ if showSetup }}}
		<span class="label label-danger"><strong>[[2factor:disabled]]</strong> <i class="fa fa-circle"></i></span>
		{{{ else }}}
		<span class="label label-success"><strong>[[2factor:enabled]]</strong> <i class="fa fa-circle"></i></span>
		{{{ end }}}
	</h3>

	<!-- IF showSetup -->
	<p>[[2factor:user.settings.intro-types]]</p>
	<div class="text-center">
		<button class="btn btn-primary" data-action="regenerateTOTP">[[2factor:user.settings.enableTOTP]]</button>
		<button class="btn btn-primary" data-action="regenerateU2F">[[2factor:user.settings.enableU2F]]</button>
	</div>
	<!-- ELSE -->
	<div class="btn-group" role="group" aria-label="Two-Factor Authentication User Settings">
		<button class="btn btn-info" data-action="generateBackupCodes">[[2factor:user.settings.generateBackupCodes]]</button>
		<button class="btn btn-danger" data-action="disassociate">[[2factor:user.settings.disable]]</button>
	</div>
	<!-- ENDIF showSetup -->
</div>