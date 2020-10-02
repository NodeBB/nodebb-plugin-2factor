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
							<!-- IF ../picture -->
							<img class="avatar avatar-sm" component="user/picture" src="{../picture}" itemprop="image" />
							<!-- ELSE -->
							<div class="avatar avatar-sm" component="user/picture" style="background-color: {../icon:bgColor};">{../icon:text}</div>
							<!-- END -->
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

		<div class="panel panel-default">
			<div class="panel-heading">[[2factor:admin.force_2fa]]</div>
			<div class="panel-body">
				<form class="2factor-settings">
					<div class="form-group">
						<label for="tfaEnforcedGroups">[[2factor:admin.force_2fa.help]]</label>
						<select class="form-control" id="tfaEnforcedGroups" name="tfaEnforcedGroups" multiple>
							<!-- BEGIN groups -->
							<option value="{../name}">{../value}</option>
							<!-- END groups -->
						</select>
					</div>
				</form>
			</div>
		</div>
	</div>
</div>

<button id="save" class="floating-button mdl-button mdl-js-button mdl-button--fab mdl-js-ripple-effect mdl-button--colored">
    <i class="material-icons">save</i>
</button>
