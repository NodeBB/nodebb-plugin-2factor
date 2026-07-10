<div class="row">
	<div class="col-sm-4 offset-sm-4">
		<div class="card">
			<div class="card-header">
				<span class="fs-4"><i class="fa fa-mobile-phone"></i> {{tx("2factor:title")}}</span>
			</div>
			<div class="card-body">
				{{{ if error }}}
				<div class="alert alert-danger">
				{error}
				</div>
				{{{ end }}}

				{{{ if (devices.length != "1") }}}
				<p class="lead text-center">{{tx("2factor:authn.login.select")}}</p>
				<div class="mb-3">
					<select class="form-select" id="deviceSelect">
						{{{ each devices }}}
						<option value="{./id}">{./name}</option>
						{{{ end }}}
					</select>
				</div>
				<button type="button" class="btn btn-primary btn-block" id="authBtn">{{tx("2factor:authn.login.lead")}}</button>
				<hr />
				{{{ if !single }}}
				<p>
					<a href="{config.relative_path}/login/2fa{{{ if next }}}?next={next}{{{ end }}}"><i class="fa fa-arrow-left"></i> {{tx("2factor:choices.back")}}</a>
				</p>
				{{{ end }}}
				{{{ else }}}
				<p class="lead text-center">{{tx("2factor:authn.login.lead")}}<br /><br /><i id="statusIcon" class="fa fa-spinner fa-spin"></i></p>
				<p>{{tx("2factor:authn.login.info")}}</p>
				{{{ end }}}

				<hr />

				{{{ if (!single && (devices.length == "1")) }}}
				<p>
					<a href="{config.relative_path}/login/2fa{{{ if next }}}?next={next}{{{ end }}}"><i class="fa fa-arrow-left"></i> {{tx("2factor:choices.back")}}</a>
				</p>
				{{{ else }}}
				<p>
					<form role="form" method="post" action="{config.relative_path}/logout">
						<input type="hidden" name="csrf_token" value="{config.csrf_token}" />
						<input type="hidden" name="noscript" value="true" />

						<button class="btn btn-link text-danger"><i class="fa fa-arrow-left"></i> {{tx("2factor:choices.logout")}}</button>
					</form>
				</p>
				{{{ end }}}
			</div>
		</div>
	</div>
</div>