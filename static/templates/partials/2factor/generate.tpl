<div class="row">
	<div class="col-6">
		<div class="text-center">
			<img src="{qr}" />
		</div>
	</div>
	<div class="col-6">
		<p>
			[[2factor:generate.text]]
		</p>
		<form role="form">
			<div class="mb-3 input-group">
				<input type="text" class="form-control form-control-lg 2fa-confirm" />
				<button class="btn btn-primary btn-lg" type="button" data-action="confirm">Confirm</button>
			</div>
		</form>
	</div>
</div>
<div class="text-center mt-3">
	<p><code>{encodedKey}</code></p>
	<p><strong>[[2factor:generate.safety.title]]</strong></p>
	<p class="help-block">[[2factor:generate.safety.text]]</p>
</div>
