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

				<p>
					[[2factor:login.text]]
				</p>

				<form role="form" method="post">
					<div class="mb-3 input-group">
						<input type="text" inputmode="numeric" class="form-control form-control-large text-center" id="code" name="code" autocomplete="off" />
						<button class="btn btn-block btn-primary text-center" type="submit">[[2factor:login.verify]]</button>
					</div>
					<input type="hidden" id="csrf" name="csrf" value="{config.csrf_token}" />
				</form>

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