<div class="row">
	<div class="col-sm-6 offset-sm-3">
		<div class="card">
			<div class="card-header">
				<span class="fs-4"><i class="fa fa-key"></i> [[2factor:title]]</span>
			</div>
			<div class="card-body">
				<p class="lead">[[2factor:choices.lead]]</p>

				<ul class="list-group">
					{{{ if hasAuthn }}}
						<li class="list-group-item">
							<a href="{config.relative_path}/login/2fa/authn{{{ if next }}}?next={next}{{{ end }}}"><i class="fa fa-fw fa-key"></i> [[2factor:choices.authn]]</a>
						</li>
					{{{ end }}}
					{{{ if hasTotp }}}
						<li class="list-group-item">
							<a href="{config.relative_path}/login/2fa/totp{{{ if next }}}?next={next}{{{ end }}}"><i class="fa fa-fw fa-mobile"></i> [[2factor:choices.totp]]</a>
						</li>
					{{{ end }}}
					{{{ if hasBackupCodes }}}
						<li class="list-group-item">
							<a href="{config.relative_path}/login/2fa/backup{{{ if next }}}?next={next}{{{ end }}}"><i class="fa fa-fw fa-life-ring"></i> [[2factor:choices.backupCode]]</a>
						</li>
					{{{ end }}}
				</ul>

				<hr />

				<p>
					<form role="form" method="post" action="{config.relative_path}/logout">
						<input type="hidden" name="csrf_token" value="{config.csrf_token}" />
						<input type="hidden" name="noscript" value="true" />

						<button class="btn btn-link text-danger"><i class="fa fa-arrow-left"></i> [[2factor:choices.logout]]</button>
					</form>
				</p>
			</div>
		</div>
	</div>
</div>