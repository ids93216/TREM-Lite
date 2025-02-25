/* eslint-disable no-undef */
let WS = false;
let ws;
let ServerT = 0;
let Reconnect = now_time();
let ws_auth = false;
let disconnect_info = 0;
let init_ = false;
let sleep_state = false;
let time_ntp = 0;
let time_local = 0;
let last_get_eew_time = Date.now();
let last_get_rts_time = Date.now();

const api_domain = "api-" + Math.ceil(Math.random() * 2) + ".exptech.com.tw";
const lb_domain = "lb-" + Math.ceil(Math.random() * 4) + ".exptech.com.tw";

function _server_init() {
	if (init_) {
		return;
	}
	init_ = true;
	createWebSocket();
}

function close() {
	if (ws && ws.readyState == 1){
		ws.close();
	}
	ws = null;
	WS = false;
}

function reconnect(force = false) {
	if (!ws_auth && !force) {
		return;
	}
	if (now_time() - Reconnect < 5000) {
		return;
	}
	Reconnect = now_time();
	if (ws != null) {
		ws.close();
		ws = null;
	}
	createWebSocket();
}

function createWebSocket() {
	if(storage.getItem("key")){
		try {
			ws = new WebSocket(`wss://${lb_domain}/websocket`);
			initEventHandle();
		} catch (e) {
			reconnect();
		}
	} else {
		WS = false;
		log("Using http fetch", 1, "log", "~");
	}
}

function sleep(_state = null) {
	if (_state != null) {
		if (_state == sleep_state) {
			return;
		}
		sleep_state = _state;
		if (sleep_state) {
			plugin.emit("trem.core.sleep");
			setTimeout(() => document.getElementById("status").textContent = "💤 睡眠模式", 1000);
		} else {
			plugin.emit("trem.core.awake");
		}
	}
	if (!WS) {
		return;
	}
	if (!_state) {
		last_get_data_time = Date.now();
	}
	/*ws.send(JSON.stringify({
		uuid     : localStorage.UUID,
		function : "subscriptionService",
		value    : ["trem-rts-v2", "trem-eew-v1", "report-trem-v1", "eew-v1", "report-v1"],
		key      : storage.getItem("key") ?? "",
		addition : { "trem-rts-v2": { sleep: (_state == null) ? sleep_state : _state } },
	}));*/
}

function initEventHandle() {
	ws.onclose = () => {
		webscoket_button.style.color = "grey";
		webscoket_button.style.border = "1px solid red";
		if (storage.getItem("key") && ws_auth) add_info("fa-solid fa-satellite-dish fa-2x info_icon", "#FF0000", "連線失敗", "#00BB00", "WebSocket 已斷線<br>正在使用 HTTP 連線", 5000);
		WS = false;
		void 0;
	};
	ws.onerror = () => {
		void 0;
	};
	ws.onopen = () => {
		ws_auth = false;
		const config = {
			type : "start",
			service : ["trem.rts", "trem.eew", "websocket.eew", "websocket.report"],
			key : storage.getItem("key") ?? "",
		};
		ws.send(JSON.stringify(config));
		plugin.emit("trem.core.websocket-connect");
	};
	ws.onmessage = (evt) => {
		if(!rts_replay_time) {
			time.style.color = "white";
		}
		WS = true;
		ServerT = now_time();
		const json = JSON.parse(evt.data);
		if (json.type == "info" && json.data.code != 200 && !ws_auth) {
			if (json.data.message == "This key already in used!") {
				add_info("fa-solid fa-satellite-dish fa-2x info_icon", "#FF0000", "連線錯誤", "#00BB00", "無法註冊 WebSocket 服務<br>此 apiKey 已在使用中，請稍候再試", 5000);
			} else {
				add_info("fa-solid fa-satellite-dish fa-2x info_icon", "#FF0000", "連線錯誤", "#00BB00", "無法註冊 WebSocket 服務<br>請檢查授權狀態", 5000);
			}
			log(`Websocket reg NG: ${json.data.message}`, 3, "log", "~");
			ws.close();
			ws = null;
			return;
		}
		// if (json.type != "data" && json.type != "ntp") {
			// console.log(json)
		// }
		if (json.type == "verify") {
			const config = {
				type : "start",
				service : ["trem.rts", "trem.eew", "websocket.eew", "websocket.report"],
				key : storage.getItem("key") ?? "",
			};
			ws.send(JSON.stringify(config));
		} else if (json.type == "info" && json.data.code == 200) {
			ws_auth = true;
			webscoket_button.style.color = "white";
			webscoket_button.style.border = "1px solid white";
			add_info("fa-solid fa-network-wired fa-2x info_icon", "#00AA00", "連線成功", "#00BB00", "已連線並註冊 WebSocket 伺服器", 5000);
			log("Websocket reg OK", 1, "log", "~");
		} else if (json.type == "data" && json.data.type == "rts") {
			get_data({
				type : "trem-rts",
				raw  : json.data.data,
			});
		} else if (json.type == "ntp") {
			time_ntp = json.time;
			time_local = Date.now();
		} else if (json.response == undefined) {
			get_data(json);
		}
	};
}

async function fetchDataWithRetry(url, maxRetries = 3, delay = 1000) {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), delay);
			const res = await fetch(url, { signal: controller.signal });
			clearTimeout(timer);
			if (res.ok) {
				return await res.json();
			} else {
				throw new Error("Server error");
			}
		} catch (err) {
			if (i === maxRetries - 1) {
				throw err;
			}
			await new Promise(res => setTimeout(res, delay));
			delay *= 2;
		}
	}
}

function Now() {
	return new Date(time_ntp + (Date.now() - time_local));
}

setInterval(() => {
	if(!storage.getItem("key")) return;
	if (now_time() - ServerT > 120_000) {
		plugin.emit("trem.core.websocket-disconnect");
		reconnect();
		WS = false;
		time.style.color = "red";
		log("Websocket long time no got msg, timeout", 1, "log", "~");
		if (now_time() - disconnect_info > 60_000) {
			disconnect_info = now_time();
			add_info("fa-solid fa-satellite-dish fa-2x info_icon", "#FF0000", "網路異常", "#00BB00", "WebSocket 伺服器沒有回應<br>請檢查網路狀態或稍後重試", 5000);
		}
	}
}, 3000);

function _speed(depth, distance) {
	const Za = 1 * depth;
	let G0, G;
	const Xb = distance;
	if (depth <= 40) {
		G0 = 5.10298;
		G = 0.06659;
	} else {
		G0 = 7.804799;
		G = 0.004573;
	}
	const Zc = -1 * (G0 / G);
	const Xc = (Math.pow(Xb, 2) - 2 * (G0 / G) * Za - Math.pow(Za, 2)) / (2 * Xb);
	let Theta_A = Math.atan((Za - Zc) / Xc);
	if (Theta_A < 0) {
		Theta_A = Theta_A + Math.PI;
	}
	Theta_A = Math.PI - Theta_A;
	const Theta_B = Math.atan(-1 * Zc / (Xb - Xc));
	let Ptime = (1 / G) * Math.log(Math.tan((Theta_A / 2)) / Math.tan((Theta_B / 2)));
	const G0_ = G0 / 1.732;
	const G_ = G / 1.732;
	const Zc_ = -1 * (G0_ / G_);
	const Xc_ = (Math.pow(Xb, 2) - 2 * (G0_ / G_) * Za - Math.pow(Za, 2)) / (2 * Xb);
	let Theta_A_ = Math.atan((Za - Zc_) / Xc_);
	if (Theta_A_ < 0) {
		Theta_A_ = Theta_A_ + Math.PI;
	}
	Theta_A_ = Math.PI - Theta_A_;
	const Theta_B_ = Math.atan(-1 * Zc_ / (Xb - Xc_));
	let Stime = (1 / G_) * Math.log(Math.tan(Theta_A_ / 2) / Math.tan(Theta_B_ / 2));
	if (distance / Ptime > 7) {
		Ptime = distance / 7;
	}
	if (distance / Stime > 4) {
		Stime = distance / 4;
	}
	return { Ptime: Ptime, Stime: Stime };
}