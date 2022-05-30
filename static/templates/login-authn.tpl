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

				<p class="lead text-center">[[2factor:authn.login.lead]]<br /><br /><i id="statusIcon" class="fa fa-spinner fa-spin"></i></p>
				<p>[[2factor:authn.login.info]]</p>

				<hr />

				<p>
					<a href="{config.relative_path}/login/2fa{{{ if next }}}?next={next}{{{ end }}}"><i class="fa fa-arrow-left"></i> [[2factor:choices.back]]</a>
				</p>
			</div>
		</div>
	</div>
</div>