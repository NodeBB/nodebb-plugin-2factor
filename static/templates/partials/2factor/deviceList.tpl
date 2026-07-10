{{{ if devices.length }}}
<div class="mt-2">
	{{{ each devices }}}
	<div class="d-flex justify-content-between align-items-center mb-1 ms-4 device-item" data-device-id="{./id}">
		<span><i class="fa fa-key text-muted"></i> {./name}</span>
		<div>
			<button type="button" class="btn btn-sm btn-link device-rename" data-device-id="{./id}" title="{{tx("2factor:authn.rename")}}"><i class="fa fa-edit"></i></button>
			<button type="button" class="btn btn-sm btn-link device-remove text-danger" data-device-id="{./id}" title="{{tx("2factor:authn.remove")}}"><i class="fa fa-trash"></i></button>
		</div>
	</div>
	{{{ end }}}
</div>
{{{ end }}}
