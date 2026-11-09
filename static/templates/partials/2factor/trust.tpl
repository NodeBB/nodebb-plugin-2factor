{{{ if trustDays }}}
<div class="form-check mb-3">
	<input class="form-check-input" type="checkbox" id="trust" name="trust" value="1" />
	<label class="form-check-label" for="trust">{{tx("2factor:login.trust", trustDays)}}</label>
</div>
{{{ end }}}
