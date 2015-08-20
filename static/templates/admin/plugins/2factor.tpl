<div class="row">
	<div class="col-xs-12">
		<div class="panel panel-default">
			<div class="panel-heading">[[2factor:intro.title]]</div>
			<div class="panel-body">
				<img src="data:image/png;base64,{image}" class="pull-right" alt="User Profile" />
				<p>
					[[2factor:admin.intro.one]]
				</p>
				<p>
					[[2factor:admin.intro.two]]
				</p>
			</div>
		</div>
	</div>
</div>
<div class="row">
	<div class="col-sm-6">
		<div class="panel panel-default">
			<div class="panel-heading">[[2factor:admin.users.title]]</div>
			<div class="panel-body">
				<p>
					[[2factor:admin.users.text]]
				</p>
				<!-- IF users.length -->
				<ul class="user-list">
					<!-- BEGIN users --><li>
						<a href="{users.config.relative_path}/user/{users.userslug}">
							<img src="{users.picture}" title="{users.username}" />
							{users.username}
						</a>
					</li><!-- END users -->
				</ul>
				<!-- ELSE -->
				<div class="alert alert-warning text-center">
					<em>[[2factor:admin.users.none]]</em>
				</div>
				<!-- ENDIF users.length -->
			</div>
		</div>
	</div>
	<div class="col-sm-6">
		<div class="panel panel-default">
			<div class="panel-heading">[[2factor:admin.deactivate.title]]</div>
			<div class="panel-body">
				<input class="form-control" type="text" name="disassociate" placeholder="[[2factor:admin.deactivate.search]]" />
				<p class="help-block">
					[[2factor:admin.deactivate.text]]
				</p>
			</div>
		</div>
	</div>
</div>
