<div class="flex-fill">
	<div class="mx-auto">
		<div class="d-flex flex-column gap-3 justify-content-center text-center">
			<div class="mx-auto p-4 bg-light border rounded">
				<i class="text-secondary fa fa-fw fa-4x fa-lock"></i>
			</div>

			<p class="lead">[[2factor:failureInfo.lead]]</p>

			<blockquote>
				[[2factor:notification.failure]]
			</blockquote>

			<div class="text-start col-sm-6 offset-sm-3">
				<p>[[2factor:failureInfo.when, {timeString}, {dateString}]]</p>
				<p>[[2factor:failureInfo.explanation]]</p>
				<p>[[2factor:failureInfo.remediation]]</p>

				<div class="d-grid">
					<a href="{config.relative_path}/me/edit/password" class="btn btn-primary">[[2factor:failureInfo.cta]]</a>
				</div>
			</div>
		</div>
	</div>
</div>


