<!-- IF showSetup -->
<div class="card">
	<div class="card-header">
		[[2factor:intro.title]]
	</div>
	<div class="card-block">
		<p>
			[[2factor:user.intro.one]]
		</p>
		<p>
			[[2factor:user.intro.two]]
		</p>
		<p>
			[[2factor:user.intro.three]]
		</p>
	</div>
</div>
<!-- ENDIF showSetup -->
<div class="card">
	<div class="card-header">
		<!-- IF showSetup -->
		<span class="text-danger pull-xs-right"><strong>[[2factor:disabled]]</strong> <i class="fa fa-circle"></i></span>
		<!-- ELSE -->
		<span class="text-success pull-xs-right"><strong>[[2factor:enabled]]</strong> <i class="fa fa-circle"></i></span>
		<!-- ENDIF showSetup -->
		[[2factor:user.settings.title]]
	</div>
	<div class="card-block">
		<!-- IF showSetup -->
		<button class="btn btn-primary" data-action="regenerate">[[2factor:user.settings.enable]]</button>
		<!-- ELSE -->
		<div class="btn-group" role="group" aria-label="Two-Factor Authentication User Settings">
			<button class="btn btn-info" data-action="generateBackupCodes">[[2factor:user.settings.generateBackupCodes]]</button>
			<button class="btn btn-danger" data-action="disassociate">[[2factor:user.settings.disable]]</button>
		</div>
		<!-- ENDIF showSetup -->
	</div>
</div>