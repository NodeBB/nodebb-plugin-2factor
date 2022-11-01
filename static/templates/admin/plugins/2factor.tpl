<div class="row">
	<div class="col-12">
		<div class="card">
			<div class="card-header">[[2factor:intro.title]]</div>
			<div class="card-body">
				<img src="data:image/png;base64,{image}" class="float-end" alt="User Profile" />
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
		<div class="card">
			<div class="card-header">[[2factor:admin.users.title]]</div>
			<div class="card-body">
				<p>
					[[2factor:admin.users.text]]
				</p>
				<!-- IF users.length -->
				<ul class="user-list">
					<!-- BEGIN users --><li>
						<a href="{users.config.relative_path}/user/{users.userslug}">
							<!-- IF ../picture -->
							<img class="avatar" component="user/picture" style="--avatar-size: 32px;" src="{../picture}" itemprop="image" />
							<!-- ELSE -->
							<div class="avatar" component="user/picture" style="--avatar-size: 32px; background-color: {../icon:bgColor};">{../icon:text}</div>
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
		<div class="card">
			<div class="card-header">[[2factor:admin.deactivate.title]]</div>
			<div class="card-body">
				<input class="form-control" type="text" name="disassociate" placeholder="[[2factor:admin.deactivate.search]]" />
				<p class="help-block">
					[[2factor:admin.deactivate.text]]
				</p>
			</div>
		</div>

		<div class="card">
			<div class="card-header">[[2factor:admin.force_2fa]]</div>
			<div class="card-body">
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

<!-- IMPORT admin/partials/save_button.tpl -->
