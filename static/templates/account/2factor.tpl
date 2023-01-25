<!-- IMPORT partials/account/header.tpl -->

<div class="row">
	<div class="col-12 col-sm-8 offset-sm-2">
		{{{ if (!hasTotp && !hasAuthn) }}}
			<p class="lead">
				[[2factor:user.intro.one]]
			</p>
			<p>
				[[2factor:user.intro.two]]
			</p>
			<p>
				[[2factor:user.intro.three]]
			</p>
		{{{ else }}}
			<p class="lead text-center">
				[[2factor:user.manage.lead]]
			</p>
		{{{ end }}}
	</div>
</div>

<hr />

<div class="row">
	<div class="list-group col-12 col-sm-8 offset-sm-2">
		<div class="list-group-item">
			<div class="pull-right">
				<a role="button" data-action="setupAuthn" class="{{{ if hasAuthn }}}text-muted{{{ end }}}">[[2factor:user.manage.enable]]</a>
				&nbsp;&nbsp;&nbsp;&nbsp;
				<a role="button" data-action="disableAuthn" class="{{{ if !hasAuthn }}}text-muted{{{ end }}}">[[2factor:user.manage.disable]]</a>
			</div>
			<i class="fa fa-fw fa-key"></i> [[2factor:choices.authn]]
			<div class="clear"></div>
		</div>
		<div class="list-group-item">
			<div class="pull-right">
				<a role="button" data-action="setupTotp" class="{{{ if hasTotp }}}text-muted{{{ end }}}">[[2factor:user.manage.enable]]</a>
				&nbsp;&nbsp;&nbsp;&nbsp;
				<a role="button" data-action="disableTotp" class="{{{ if !hasTotp }}}text-muted{{{ end }}}">[[2factor:user.manage.disable]]</a>
			</div>
			<i class="fa fa-fw fa-mobile"></i> [[2factor:choices.totp]]
			<div class="clear"></div>
		</div>
		<div class="list-group-item">
			<div class="pull-right">
				{{{ if backupCodeCount }}}<span class="text-muted">({backupCodeCount} remaining)</span>{{{ end }}}
				<a href="#" role="button" data-action="generateBackupCodes">
					{{{ if backupCodeCount }}}[[2factor:user.manage.regenerate]]{{{ else }}}[[2factor:user.manage.generate]]{{{ end }}}</a>
			</div>
			<i class="fa fa-fw fa-life-ring"></i> [[2factor:choices.backupCode]]
			<div class="clear"></div>
		</div>
	</div>
</div>

<!-- IMPORT partials/account/footer.tpl -->