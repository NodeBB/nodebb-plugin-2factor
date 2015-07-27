<div class="row">
	<div class="col-xs-6">
		<div class="text-center">
			<img src="{qr}" />
		</div>
	</div>
	<div class="col-xs-6">
		<p>
			The QR code shown above will allow you to associate your mobile device (via the GAuthenticator
			app or a suitable variant) with your account on this website. Simply scan it via the app, and
			key in the generated token to confirm.
		</p>
		<form role="form">
			<div class="input-group">
				<input type="text" class="form-control input-lg 2fa-confirm" />
				<span class="input-group-btn">
					<button class="btn btn-primary btn-lg" type="button" data-action="confirm">Confirm</button>
				</span>
			</div>
		</form>
	</div>
</div>
<div class="text-center">
	<br />
	<strong>Keep this token safe! Others can use it to register their devices with your account.</strong>
	<p class="help-block">
		For security purposes, the QR code will only be shown here. In the event your device is lost
		or is otherwise unavailable, you will not be able to log into NodeBB unless 2FA is deactivated
		on your account.
	</p>
</div>
