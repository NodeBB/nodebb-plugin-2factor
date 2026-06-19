<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 px-2 mb-4" tabindex="0">
			<h5 class="fw-bold tracking-tight settings-header">[[2factor:intro.title]]</h5>
			<img src="data:image/png;base64,{image}" class="float-end" alt="User Profile" />
			<p>
				[[2factor:admin.intro.one]]
			</p>
			<p>
				[[2factor:admin.intro.two]]
			</p>

			<form role="form" class="2factor-settings clearfix">
				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">[[2factor:admin.users.title]]</h5>
					<p>
						[[2factor:admin.users.text]]
					</p>

					{{{ if users.length }}}
					<ul class="user-list list-group list-group-horizontal">
						{{{ each users }}}
						<li class="list-group-item">
							<a href="{users.config.relative_path}/user/{users.userslug}">
								{{buildAvatar(@value)}}
							</a>
							<a href="{users.config.relative_path}/user/{users.userslug}">
								{users.username}
							</a>
						</li>
						{{{ end }}}
					</ul>
					{{{ else }}}
					<div class="alert alert-warning text-center">
						<em>[[2factor:admin.users.none]]</em>
					</div>
					{{{ end }}}
				</div>

				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">[[2factor:admin.deactivate.title]]</h5>
					<div class="mb-3">
						<input class="form-control" type="text" name="disassociate" placeholder="[[2factor:admin.deactivate.search]]" />
						<p class="form-text">
							[[2factor:admin.deactivate.text]]
						</p>
					</div>
				</div>

				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">[[2factor:admin.force_2fa]]</h5>
					<div class="mb-3">
						<div class="form-group">
							<label for="tfaEnforcedGroups">[[2factor:admin.force_2fa.help]]</label>
							<select class="form-select" id="tfaEnforcedGroups" name="tfaEnforcedGroups" multiple>
								<!-- BEGIN groups -->
								<option value="{../name}">{../value}</option>
								<!-- END groups -->
							</select>
						</div>
					</div>
				</div>
			</form>
		</div>
	</div>
</div>


