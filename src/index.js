async function boot_omni() {
	const omni = await require("omni").create();
	const http = require("http");
	const express = require("express");
	const app = express();
	const server = http.createServer(app);
	const port = 80;
	const { Server } = require("socket.io");
	const io = new Server(server);
	
	const path = require("path");
	const public_directory = path.join(__dirname, "public");

	let user_to_socket_map = new Map();
	
	app.use(express.static(public_directory));
	app.use(express.json());
	
	omni.start("omniconf.json");
	
	// TODO: Handle all events
	omni.on("message", (data) => {
		io.emit("msg_rcv", data);
	});
	
	omni.on("user_online", (data) => {
		io.emit("user_online", data);
	});
	
	omni.on("user_offline", (data) => {
		io.emit("user_offline", data);
	});
	
	omni.on("channel_create", (data) => {
		io.emit("channel_create", data);
	});
	
	omni.on("channel_delete", (data) => {
		io.emit("channel_delete", data);
	});

	omni.on("pair_request", async (data) => {
		let users = await omni.get_all_online_local_users();

		for (let user of users) {
			if (user.attributes.admin) {
				let socket = user_to_socket_map.get(user.id);
				socket.emit("pair_request", data);
			}
		}
	});

	omni.on("pair_accept", async (data) => {
		let peer = await omni.get_peer(data.id);
		let users = await omni.get_all_online_local_users();

		for (let user of users) {
			let socket = user_to_socket_map.get(user.id);
			socket.emit("peer_info", data);
		}
	});
	
	app.post("/api/new_account", async (req, res) => {
		const username = req.body.username;
		const admin = req.body.admin ? true : false;
	
		// Validate username
		if (username.length < 3) {
			res.status(400).send("Username must be at least 3 characters long.");
			return;
		}
		if (username.length > 32) {
			res.status(400).send("Username must be at most 32 characters long.");
			return;
		}
		if (!username.match(/^[a-zA-Z0-9_\-]+$/)) {
			res.status(400).send("Username must only contain letters, numbers, underscores, and dashes.");
			return;
		}
	
		const user_id = await omni.create_user(username, admin);
	
		if (user_id) {
			res.status(200).send(user_id);
		}
		else {
			res.status(500).send("Failed to create user.");
		}
	});
	
	io.on("connection", (socket) => {
		socket.once("login", async (user_id) => {
			if (await omni.login_user(user_id)) {
				console.log("New user connection!", user_id);
			}
			else {
				console.log("User login failed!", user_id);
				socket.emit("login_fail");
				return;
			}
	
			const user = await omni.get_user(user_id);

			user_to_socket_map.set(user_id, socket);
	
			socket.on("disconnect", () => {
				console.log("User disconnected!", user_id);
				user_to_socket_map.delete(user_id);
				omni.logout_user(user_id);
			});
	
			socket.on("msg_send", async (data) => {
				const id_new_msg = await omni.send_message(user_id, data.channel_id, data.message);
			});
	
			socket.on("channel_join", async (data) => {
				console.log("User " + user_id + " joined channel " + data.channel_id);
				// Send user the last 50 messages
				const messages = await omni.get_messages(data.channel_id, Date.now());
				for (let message of messages) {
					socket.emit("msg_rcv", message);
				}
			});
	
			socket.on("get_user", async (user_id) => {
				socket.emit("user_info", await omni.get_user(user_id));
			});

			socket.on("get_peer", async (peer_id) => {
				socket.emit("peer_info", await omni.get_peer(peer_id));
			});

			socket.on("channel_create", async (data) => {
				if (user.attributes.admin) {
					// Validate channel name
					if (!data.name.match(/^[a-zA-Z0-9\-]+$/)) {
						socket.emit("channel_create_fail", "Channel name must only contain letters, numbers, and dashes.");
						return;
					}

					const channel_id = await omni.create_channel(data.name, data.admin_only);
					console.log(`User ${user_id} created channel ${channel_id}`);
				}
			});
	
			socket.on("channel_delete", async (channel_id) => {
				if (user.attributes.admin) {
					let success = await omni.delete_channel(channel_id);
					if (success) {
						console.log(`User ${user_id} deleted channel ${channel_id}`);
					}
					else {
						console.log(`User ${user_id} failed to delete channel ${channel_id}`);
					}
				}
			});

			socket.on("send_pair_request", async (data) => {
				if (user.attributes.admin) {
					omni.send_pair_request(data.address, data.port);
				}
			});

			socket.on("respond_to_pair_request", async (data) => {
				if (user.attributes.admin) {
					omni.respond_to_pair_request(data.id, data.accepted);
				}
			});

			// Send the user their own info
			socket.emit("my_user", user);
	
			// Send the user a list of all online users
			const online_users = omni.get_all_online_users(); // For now this API is synchronous
			for (let user_id of online_users) {
				socket.emit("user_online", await omni.get_user(user_id));
			}
	
			// Send the user a list of all channels
			const channels = await omni.get_all_channels();
			for (let channel of channels) {
				if (channel.attributes.admin_only && !user.attributes.admin) {
					continue;
				}
				socket.emit("channel_create", channel);
			}
		});
	
		socket.emit("login_poke");
	});
	
	// DEMO ONLY: Make a couple test channels
	await omni.create_channel("general");
	await omni.create_channel("general-2");
	await omni.create_channel("admins-only", true);
	
	server.listen(port, () => {
		console.log(`Server started at port ${port}`);
	});
}

boot_omni();