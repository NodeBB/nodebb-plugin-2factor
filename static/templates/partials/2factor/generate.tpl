<div class="d-flex gap-5 align-items-center">
	<div class="text-center">
		<img src="{qr}" />
	</div>
	<div>
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
<div class="text-center mt-3 pt-3 border-top">
	<p>[[2factor:generate.manual-entry]]</p>
	<p class="font-monospace user-select-all text-info">{encodedKey}</p>
	<p><strong>[[2factor:generate.safety.title]]</strong></p>
	<p class="help-block">[[2factor:generate.safety.text]]</p>
</div>
