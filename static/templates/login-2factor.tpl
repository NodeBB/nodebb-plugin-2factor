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

				{{{ if authnOptions }}}
					<p class="lead text-center">[[2factor:u2f.login.lead]]<br /><br /><i class="fa fa-spinner fa-spin"></i></p>
					<p>[[2factor:u2f.login.info]]</p>
				{{{ else }}}
					<p>
						[[2factor:login.text]]
					</p>

					<form role="form" method="post">
						<div class="form-group">
							<input type="text" class="form-control input-lg text-center" id="code" name="code" autocomplete="off" />
						</div>
						<input type="hidden" id="csrf" name="csrf" value="{config.csrf_token}" />
						<button class="btn btn-block btn-primary text-center" type="submit">[[2factor:login.verify]]</button>
						<hr />
						<p class="text-center">
							<a href="{config.relative_path}/login/2fa/backup"><i class="fa fa-life-ring"></i> [[2factor:login.use_backup]]</a>
						</p>
					</form>
				{{{ end }}}
			</div>
		</div>
	</div>
</div>