<div class="row">
	<div class="col-md-4 offset-md-4">
		<div class="card">
			<div class="card-header">
				<i class="fa fa-mobile-phone"></i> [[2factor:title]]
			</div>
			<div class="card-block">
				<p>
					[[2factor:login.text]]
				</p>
				<!-- IF error -->
				<div class="alert alert-danger">
				{error}
				</div>
				<!-- ENDIF error -->
				<form role="form" method="post">
					<div class="form-group">
						<input type="text" class="form-control input-lg text-xs-center" id="code" name="code" />
					</div>
					<input type="hidden" id="csrf" name="csrf" value="{config.csrf_token}" />
					<button class="btn btn-block btn-primary text-xs-center" type="submit">[[2factor:login.verify]]</button>
					<hr />
					<p class="text-xs-center">
						<a href="{config.relative_path}/login/2fa/backup"><i class="fa fa-life-ring"></i> [[2factor:login.use_backup]]</a>
					</p>
				</form>
			</div>
		</div>
	</div>
</div>