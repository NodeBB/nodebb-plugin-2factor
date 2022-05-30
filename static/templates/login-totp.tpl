<div class="row">
	<div class="col-sm-4 col-sm-offset-4">
		<div class="panel panel-default">
			<div class="panel-heading">
				<h3 class="panel-title"><i class="fa fa-mobile-phone"></i> [[2factor:title]]</h3>
			</div>
			<div class="panel-body">
				<!-- IF error -->
				<div class="alert alert-danger">
				{error}
				</div>
				<!-- ENDIF error -->

				<p>
					[[2factor:login.text]]
				</p>

				<form role="form" method="post">
					<div class="form-group">
						<input type="text" class="form-control input-lg text-center" id="code" name="code" autocomplete="off" />
					</div>
					<input type="hidden" id="csrf" name="csrf" value="{config.csrf_token}" />
					<button class="btn btn-block btn-primary text-center" type="submit">[[2factor:login.verify]]</button>
				</form>

				<hr />

				<p>
					<a href="{config.relative_path}/login/2fa{{{ if next }}}?next={next}{{{ end }}}"><i class="fa fa-arrow-left"></i> [[2factor:choices.back]]</a>
				</p>
			</div>
		</div>
	</div>
</div>