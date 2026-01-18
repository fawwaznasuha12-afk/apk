// Wait for the deviceready event before using any of Cordova's device APIs.
// See https://cordova.apache.org/docs/en/latest/cordova/events/events.html#deviceready
document.addEventListener('deviceready', onDeviceReady, false);

function onDeviceReady() {
    // Cordova is now initialized. Have fun!

    console.log('Running cordova-' + cordova.platformId + '@' + cordova.version);
    document.getElementById('deviceready').innerHTML = '';

    // Check network connection
    checkNetworkConnection();

    // Handle back button
    document.addEventListener("backbutton", onBackKeyDown, false);

    // Handle app pause/resume
    document.addEventListener("pause", onPause, false);
    document.addEventListener("resume", onResume, false);
}

function checkNetworkConnection() {
    var networkState = navigator.connection.type;

    var states = {};
    states[Connection.UNKNOWN]  = 'Unknown connection';
    states[Connection.ETHERNET] = 'Ethernet connection';
    states[Connection.WIFI]     = 'WiFi connection';
    states[Connection.CELL_2G]  = 'Cell 2G connection';
    states[Connection.CELL_3G]  = 'Cell 3G connection';
    states[Connection.CELL_4G]  = 'Cell 4G connection';
    states[Connection.CELL]     = 'Cell generic connection';
    states[Connection.NONE]     = 'No network connection';

    console.log('Connection type: ' + states[networkState]);

    if (networkState === Connection.NONE) {
        alert('No internet connection detected. Please check your network settings.');
    }
}

function onBackKeyDown() {
    // Handle back button - maybe go back in webview or exit app
    var webapp = document.getElementById('webapp');
    if (webapp.contentWindow.history.length > 1) {
        webapp.contentWindow.history.back();
    } else {
        navigator.app.exitApp();
    }
}

function onPause() {
    console.log('App paused');
}

function onResume() {
    console.log('App resumed');
    checkNetworkConnection();
}
