extends Node
## Porter's client in a Godot web export.
##
## Add this script as an autoload named `Porter`. It reads the facade that `exposeToGodot(porter)`
## of `@porterkit/godot` leaves in the page, so the page calls it before it starts the engine.
## Everything arrives as JSON: a number is a float, and an object is a Dictionary.

signal connection_changed(connection: Dictionary)
## `room` is null while there is no room.
signal room_changed(room: Variant)
## `game` is null while there is no room.
signal game_changed(game: Variant)

signal _answered(question: int, answer: Variant)

var connection: Dictionary = {"status": "idle"}
var room: Variant = null
var game: Variant = null

var _facade: JavaScriptObject
# JavaScript loses a callback that Godot no longer references.
var _on_change: JavaScriptObject
var _listeners: Dictionary[int, JavaScriptObject] = {}
var _pending: Dictionary[int, JavaScriptObject] = {}
var _questions := 0


func _ready() -> void:
	_facade = JavaScriptBridge.get_interface("porterGodot")
	if _facade == null:
		push_error("Porter: no facade in the page. It needs a web export and exposeToGodot(porter) before the engine starts")
		return
	_on_change = JavaScriptBridge.create_callback(_changed)
	_facade.subscribe(_on_change)


## Resolves with `{ ok, roomId }` or `{ ok, reason }`, or with null when the request itself failed.
func login(request: Dictionary) -> Variant:
	var question := _question()
	_facade.login(JSON.stringify(request), _pending[question])
	return JSON.parse_string(await _answer(question))


## Resolves with a bool, or with null when the request itself failed.
func room_exists(room_id: String) -> Variant:
	var question := _question()
	_facade.roomExists(room_id, _pending[question])
	return await _answer(question)


func resume() -> bool:
	return _facade.resume()


func reconnect() -> void:
	_facade.reconnect()


func leave() -> void:
	_facade.leave()


## Returns false, and sends nothing, unless connected. Without `data` the message carries none.
func send(event: String, data: Variant = null) -> bool:
	if data == null:
		return _facade.send(event)
	return _facade.send(event, JSON.stringify(data))


## Calls `listener` with the data of every `event`. Returns the number that takes it off.
func on(event: String, listener: Callable) -> int:
	var callback := JavaScriptBridge.create_callback(
		func(args: Array) -> void: listener.call(JSON.parse_string(args[0]))
	)
	var id := int(_facade.on(event, callback))
	_listeners[id] = callback
	return id


func off(listener: int) -> void:
	_facade.off(listener)
	_listeners.erase(listener)


## Milliseconds left, or -1 when the active Match has no timer of that name.
func timer_remaining(timer: String) -> float:
	return _facade.timerRemaining(timer)


func _changed(args: Array) -> void:
	var parts: Dictionary = JSON.parse_string(args[0])
	# Every part is in place before anyone is told: `connected` never comes without its room.
	if parts.has("connection"):
		connection = parts.connection
	if parts.has("room"):
		room = parts.room
	if parts.has("game"):
		game = parts.game
	if parts.has("connection"):
		connection_changed.emit(connection)
	if parts.has("room"):
		room_changed.emit(room)
	if parts.has("game"):
		game_changed.emit(game)


func _question() -> int:
	_questions += 1
	var question := _questions
	_pending[question] = JavaScriptBridge.create_callback(
		func(args: Array) -> void: _answered.emit(question, args[0])
	)
	return question


func _answer(question: int) -> Variant:
	while true:
		var answered: Array = await _answered
		if answered[0] == question:
			# Deferred: the callback is still running.
			_forget.call_deferred(question)
			return answered[1]
	return null


func _forget(question: int) -> void:
	_pending.erase(question)
