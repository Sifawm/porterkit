extends VBoxContainer
## The whole example: login, waiting room and Match of the counter, drawn again after every change.

var _error := ""
var _rejection := ""


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, 16)
	Porter.connection_changed.connect(func(_connection: Dictionary) -> void: _render())
	Porter.room_changed.connect(func(_room: Variant) -> void: _render())
	Porter.game_changed.connect(func(_game: Variant) -> void: _render())
	Porter.on("porter:messageRejected", _rejected)
	Porter.resume()
	_render()


func _render() -> void:
	for child in get_children():
		remove_child(child)
		child.queue_free()
	match Porter.connection.status:
		"connected":
			_room()
		"connecting", "reconnecting":
			_label("Connecting…")
		_:
			_closed()


func _closed() -> void:
	if Porter.connection.status == "closed":
		_label("Connection closed: %s" % Porter.connection.reason)
		if Porter.connection.reason == "unreachable":
			_button("Try again", Porter.reconnect)
			return
	var name_field := LineEdit.new()
	name_field.placeholder_text = "Name"
	add_child(name_field)
	var room_id := LineEdit.new()
	room_id.placeholder_text = "Room (empty creates one)"
	room_id.text = str(JavaScriptBridge.eval("location.hash.slice(1)"))
	add_child(room_id)
	_button("Join or create", func() -> void: _login(name_field.text, room_id.text))
	if _error != "":
		_label(_error)


func _login(user_name: String, room_id: String) -> void:
	var request := {"name": user_name, "profile": null}
	if room_id != "":
		if await Porter.room_exists(room_id) == false:
			return _fail("roomNotFound")
		request.roomId = room_id
	var result: Variant = await Porter.login(request)
	if result == null:
		return _fail("the server did not answer")
	if not result.ok:
		return _fail(result.reason)
	_error = ""
	JavaScriptBridge.get_interface("location").hash = result.roomId


func _fail(reason: String) -> void:
	_error = reason
	_render()


func _room() -> void:
	var room: Dictionary = Porter.room
	var game: Dictionary = Porter.game
	var situation: Dictionary = game["match"]
	_label("Room %s" % room.id)
	_button("Leave", Porter.leave)
	for user: Dictionary in game.users:
		var line := "%s: %d" % [user.name, user.data.clicks]
		if user.name == room.admin:
			line += " (Admin)"
		if user.status == "reconnecting":
			line += " (away)"
		_label(line)

	if situation.status == "running" or situation.status == "paused":
		_label("%d / %d%s" % [game.state.count, game.settings.target, " (paused)" if situation.status == "paused" else ""])
		_button("+1", func() -> void: Porter.send("increment"))
		if room.isAdmin:
			if situation.status == "paused":
				_button("Continue", func() -> void: Porter.send("porter:continueMatch"))
			else:
				_button("Pause", func() -> void: Porter.send("porter:pauseMatch", {"reason": null}))
			_button("End", func() -> void: Porter.send("porter:endMatch"))
	else:
		if situation.status == "ended":
			var reason: Dictionary = situation.reason
			if reason.by == "game":
				_label("%s reached %d" % [reason.reason.reachedBy, game.state.count])
			else:
				_label("Match ended (%s)" % reason.by)
		_label("Target: %d" % game.settings.target)
		if room.isAdmin:
			_button("Target +5", func() -> void: Porter.send("porter:updateSettings", {"target": game.settings.target + 5}))
			_button("Start", func() -> void: Porter.send("porter:startMatch"))
	if _rejection != "":
		_label(_rejection)


func _rejected(data: Dictionary) -> void:
	var reason: Variant = data.reason
	_rejection = "%s: %s" % [data.rejected, reason if reason is String else reason.reason]
	_render()


func _label(text: String) -> void:
	var label := Label.new()
	label.text = text
	add_child(label)


func _button(text: String, action: Callable) -> void:
	var button := Button.new()
	button.text = text
	button.pressed.connect(action)
	add_child(button)
