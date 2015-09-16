<!-- IF showSetup -->
<div class="panel panel-default">
	<div class="panel-heading">
		<h3 class="panel-title">[[2factor:intro.title]]</h3>
	</div>
	<div class="panel-body">
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
<div class="panel panel-default">
	<div class="panel-heading">
		<!-- IF showSetup -->
		<span class="text-danger pull-right"><strong>[[2factor:disabled]]</strong> <i class="fa fa-circle"></i></span>
		<!-- ELSE -->
		<span class="text-success pull-right"><strong>[[2factor:enabled]]</strong> <i class="fa fa-circle"></i></span>
		<!-- ENDIF showSetup -->
		<h3 class="panel-title">[[2factor:user.settings.title]]</h3>
	</div>
	<div class="panel-body">
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