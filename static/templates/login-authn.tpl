<div class="row">
	<div class="col-sm-4 offset-sm-4">
		<div class="card">
			<div class="card-header">
				<span class="fs-4"><i class="fa fa-mobile-phone"></i> [[2factor:title]]</span>
			</div>
			<div class="card-body">
				<!-- IF error -->
				<div class="alert alert-danger">
				{error}
				</div>
				<!-- ENDIF error -->

				<p class="lead text-center">[[2factor:authn.login.lead]]<br /><br /><i id="statusIcon" class="fa fa-spinner fa-spin"></i></p>
				<p>[[2factor:authn.login.info]]</p>

				<hr />

				{{{ if !single }}}
				<p>
					<a href="{config.relative_path}/login/2fa{{{ if next }}}?next={next}{{{ end }}}"><i class="fa fa-arrow-left"></i> [[2factor:choices.back]]</a>
				</p>
				{{{ else }}}
				<p>
					<form role="form" method="post" action="{config.relative_path}/logout">
						<input type="hidden" name="csrf_token" value="{config.csrf_token}" />
						<input type="hidden" name="noscript" value="true" />

						<button class="btn btn-link text-danger"><i class="fa fa-arrow-left"></i> [[2factor:choices.logout]]</button>
					</form>
				</p>
				{{{ end }}}
			</div>
		</div>
	</div>
</div>