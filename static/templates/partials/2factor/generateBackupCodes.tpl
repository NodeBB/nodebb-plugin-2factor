<div class="row">
	<div class="col-12">
		<p class="lead">
			{{tx("2factor:backup.generate.one")}}
		</p>
		<p>
			{{tx("2factor:backup.generate.two")}}
		</p>
		<ul class="list-group text-center">
			{{{ each codes}}}
			<li class="list-group-item">{@value}</li>
			{{{ end }}}
		</ul>
	</div>
</div>
