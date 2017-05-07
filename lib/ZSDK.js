var ZSDKUtil = (function(ZSDKUtil) {

  var QueryParams = GetQueryParams();

  // Global Logger instance which will be acquired and shared by other modules.
  var GlobalLogger;

  // minimal Logging utility.
  function ZLogger(mode) {}
  ZLogger.prototype.Info = function() {
    if (ZSDKUtil.isDevMode() || ZSDKUtil.isLogEnabled()) {
        console.info.apply(null, arguments);
    }
  }
  ZLogger.prototype.Error = function() {
    if (ZSDKUtil.isDevMode() || ZSDKUtil.isLogEnabled()) {
        console.error.apply(null, arguments);
    }
  }
  function getLogger() {
    if( !GlobalLogger || !(GlobalLogger instanceof ZLogger)) {
      GlobalLogger = new ZLogger(); // Logging instance for Core Framework
    }

    return GlobalLogger;
  }
  
  function GetQueryParams(URL) {
    //TODO: Handle hash case too.
    var qParams = {};
    URL = URL || window.location.href;
    var splittedParams = URL.substr(URL.indexOf('?') + 1).split("&");
    splittedParams.forEach(function (ele, idx) {
      var miniSplit = ele.split('=');
      qParams[miniSplit[0]] = miniSplit[1];
    });
    
    return qParams;
  }
  function isDevMode() {
    return QueryParams && QueryParams['isDevMode'];
  }
  function isLogEnabled() {
    return QueryParams && QueryParams['isLogEnabled'];
  }
  
  
  // Sleep
  function Sleep(milliSeconds) {
    var startTime = new Date().getTime();
    while( (startTime + milliSeconds) > new Date().getTime()) {};
  }
  ZSDKUtil.GetQueryParams = GetQueryParams;
  ZSDKUtil.isDevMode = isDevMode;
  ZSDKUtil.isLogEnabled = isLogEnabled;
  ZSDKUtil.getLogger = getLogger;
  ZSDKUtil.Sleep = Sleep;

  return ZSDKUtil;

})(window.ZSDKUtil || {});

var ZSDKMessageManager = (function(ZSDKMessageManager) {

  var SDKContext;
  var Logger = ZSDKUtil.getLogger();
  var defaultPromiseTimeout = 10000; // Promise timeout
  var promiseIDCtr = 100;
  var PromiseQueue = {}; // Queue holding all the GetRequest promises

  var AllowedOrigins = new RegExp("^https?:\/\/[a-zA-Z0-9-_]*.(csez.zohocorpin.com|sandbox.crm-oem.com|zoho.com|zohoplatform.com|zohosandbox.com)(:[0-9]{0,4})?$");
  
  var isAppRegistered = false;
  var AuthParentWindow, AuthParentOrigin;

  var connectorsAccessCode = {}; // Temporary map which stores the access_code fetched for the connectors.
  function Init(ctx, config) { // Config is for future use
    if( !ctx || typeof ctx !== 'object' ) {
      throw Error('Invalid Context object passed');
    }
    if( config && typeof config !== 'object') {
      throw Error('Invalid Configuration Passed to MessageManager');
    }
    
    SDKContext = ctx;

    return MessageHandler.bind(ZSDKMessageManager);
  }

  // Authorization Check in SDK side.
  function isAuthorizedMessage(MEvent) {
    var incomingSource = MEvent.source;
    var incomingOrigin = MEvent.origin;

    if( isAppRegistered && AuthParentWindow === incomingSource && AuthParentOrigin === incomingOrigin ) {
      return true;
    }

    return new Error('Un-Authorized Message.');
  }
  function MessageHandler(MessageEvent) {
    var data = JSON.parse(MessageEvent.data);
    var messageType = data.type;
    var eventName = data.eventName; 

    try {

      if( eventName === 'SET_CONTEXT' || isAuthorizedMessage(MessageEvent)) {
        switch(messageType) {
          
          case 'FRAMEWORK.EVENT':
            HandleEvent(MessageEvent, data);
            break;

          case 'SDK.CNTR_ACCESS_CODE_RECEIVED':
            HandleCntrAccessCode(MessageEvent, data);
            break;

          default:
            SDKContext.MessageInterceptor(MessageEvent, data); // Future Use.
            break;

        }
      }
    } catch(e) {
      Logger.Error('[SDK.MessageHandler] => ', e.stack);
    }
  }

  function HandleEvent(MessageEvent, payload) {
    var data = payload.data;
    var eventName = payload.eventName;

    var eventHandlers = {
      'SET_CONTEXT': HandleSetContext,
      'UPDATE_CONTEXT': HandleUpdateContext,
      'EVENT_RESPONSE': HandleEventResponse
    };

    var eventHandler = eventHandlers[eventName];
    if( eventHandler && typeof eventHandler === 'function' ) {
      eventHandler(MessageEvent, payload);
    } else {
      HandleCustomEvent(MessageEvent, payload);
    }
  }
  function HandleSetContext(MessageEvent, payload) {

    var parentOrigin = MessageEvent.origin;
    if( !AllowedOrigins.test(parentOrigin)) {
      throw new Error('Messsage received from unauthorized domain.');
    }
    AuthParentWindow = MessageEvent.source;
    AuthParentOrigin = parentOrigin;

    SDKContext.SetContext(payload.data);
    SDKContext.ExecuteLoadHandler();
    isAppRegistered = true;
  }
  function HandleUpdateContext(MessageEvent, payload) {
    //SDKContext.UpdateContext(payload.data);
    //SDKContext.ExecuteLoadHandler();
  }
  function HandleCustomEvent(MessageEvent, payload) {
    ZSDKEventManager.NotifyEventListeners(SDKContext.AppContext, payload.eventName, payload.data);
  }

  function HandleEventResponse(MessageEvent, payload) {
    var promiseID = payload.promiseid;
    var response = payload.data;
    HandlePromiseCallback(promiseID, response);
  }
  function HandlePromiseCallback(promiseID, response) {
    if (PromiseQueue.hasOwnProperty(promiseID)) {
      PromiseQueue[promiseID]['resolve'](response);

      PromiseQueue[promiseID] = undefined;
      delete PromiseQueue[promiseID];
    } else {
      //TODO: Handle if there is no promiseID present
    }
  }


  function HandleCntrAccessCode(MessageEvent, payload) {
    var code = payload.code;
    var error = payload.error;
    var state = payload.state;

    if( code && (!error || error === 'undefined') ) {
      connectorsAccessCode[state] = {
        'code': code,
        'access_code_time': new Date().getTime()
      };
    } else if( (!code || code === 'undefined') && error ) {
      connectorsAccessCode[state] = {
        'error': error,
        'error_time': new Date().getTime()
      };
    }
  }

  function SendRequest(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('Invalid Options passed');
    }
    //TODO: Make this call only during devMode. Have to add extra check for DevMode
    if( options.connector && ZSDKUtil.isDevMode() ) {
      var connectors = SDKContext.GetConnectors();
      return ZSDKAPIHelper.GetRequest(options, connectors);
    }

    return SendEvent('HTTP_REQUEST', options, true);
  }
  function TriggerEvent(eventName, payload, isPromiseEvent) {

    if(!eventName) {
      throw new Error('Invalid Eventname : ', eventName);
    }

    var PromiseID = !!isPromiseEvent ? getNextPromiseID() : undefined;
    var eventObject = {
      /* Default Event Props */
      type: 'SDK.EVENT',
      eventName: eventName,
      uniqueID : SDKContext.getUniqueID(),
      time: new Date().getTime(),
      promiseid: PromiseID,

      /* User data */
      data: payload
    };

    PostMessage(eventObject);

    if( isPromiseEvent ) {
      return AddToPromiseQueue(PromiseID);
    }
  }

  // Sends the event to the Framework.
  function SendEvent(eventName, payload, isPromiseEvent) {

    if(!eventName) {
      throw new Error('Invalid Eventname : ', eventName);
    }

    var PromiseID = !!isPromiseEvent ? getNextPromiseID() : undefined;
    var eventObject = {
      /* Default Event Props */
      type: 'SDK.EVENT',
      eventName: eventName,
      uniqueID : SDKContext.getUniqueID(),
      time: new Date().getTime(),
      promiseid: PromiseID,

      /* User data */
      data: payload
    };

    PostMessage(eventObject);

    if( isPromiseEvent ) {
      return AddToPromiseQueue(PromiseID);
    }
  }
  function getNextPromiseID() {
    return 'Promise' + promiseIDCtr++;
  }
  function AddToPromiseQueue(promiseID) {

    var promise = new Promise(function (resolve, reject) {

      // Adding the promise to queue.
      PromiseQueue[promiseID] = {
        resolve: resolve,
        reject: reject,
        time: new Date().getTime()
      };
    });

    /*
     * Currently the Timeout case is disabled. Need to revisit.
    setTimeout(function () {
      if (PromiseQueue.hasOwnProperty(PromiseId)) {

        PromiseQueue[PromiseId].reject('timeout'); // TODO: Better timeout message.
        delete PromiseQueue[PromiseId];

      }
    }, defaultPromiseTimeout); // Have to define as common config props
    */

    return promise;
  }

  function RegisterApp() {

    var registerSDKClient = {
      type: 'SDK.EVENT',
      eventName: 'REGISTER'
    };

    // Initiating the Client Handshake
    window.top.postMessage(JSON.stringify(registerSDKClient), SDKContext.QueryParams.serviceOrigin);
  }
  function DERegisterApp() {
    var deRegisterSDKClient = {
      type: 'SDK.EVENT',
      eventName: 'DEREGISTER',
      uniqueID : SDKContext.getUniqueID()
    };

    PostMessage(deRegisterSDKClient);
  }
  

  // Utility functions used for OAuth operations
  function getFetchedAccessCode(requestID) {
    return connectorsAccessCode[requestID];
  }

  function UpdateConnectorData(connectorName, connectorData) {

    return new Promise(function(resolve, reject) {
      $.post({
        url: 'ht'+'tp:'+'//127.0.0.1:5000/updateconnector',
        dataType: 'json',
        data: {
          'connectorName': connectorName,
          'connectorData': JSON.stringify(connectorData)
        }
      })
      .then(
        function(response) {
          resolve(response);
        },
        function(err) {
          reject(JSON.parse(err));
        }
      );
    });
    
  }

  // Helpers
  function PostMessage(data) {
    if( typeof data === 'object' ) {
      data = JSON.stringify(data);
    }

    if( !AuthParentWindow ) {
      throw new Error('Parentwindow reference not found.');
    }
    AuthParentWindow.postMessage(data, SDKContext.QueryParams.serviceOrigin);

  }
  ZSDKMessageManager.Init = Init;
  ZSDKMessageManager.RegisterApp = RegisterApp;
  ZSDKMessageManager.DERegisterApp = DERegisterApp;

  ZSDKMessageManager.SendRequest = SendRequest;
  ZSDKMessageManager.TriggerEvent = TriggerEvent;

  ZSDKMessageManager.getFetchedAccessCode = getFetchedAccessCode;
  ZSDKMessageManager.UpdateConnectorData = UpdateConnectorData;

  return ZSDKMessageManager;
})(window.ZSDKMessageManager || {});

var ZSDKModelManager = (function(ZSDKModelManager) {

  var ModelStore = {};
  var SDKContext;
  var Logger;

  function Init(ctx) {
    SDKContext = ctx;
    //Logger = SDKContext.Logger;
  }
  // Basic Model type
  function Model(name, data) {
    this.modelName = name;
    
    if( Array.isArray(data) || typeof data !== 'object' ) {
      this.isArray = true;
      this.data = data;

      return data; // In case of primi
    } else {
      this.keys = [];
      for( var k in data ) {
        this[k] = data[k];
        this.keys.push(k);
      }
    }
  }
  // TODO: Currently no checks have been added whether the data has been updated. Hint: Use any kind of diffing technique.
  Model.prototype.Save = function() {
    
    var modelData = {};
    for( var i=0; i<this.keys.length; i++) {
      var key = this.keys[i];
      modelData[key] = this[key];
    }
  
    SDKContext.TriggerEvent('OnModelUpdate', { modelName: this.modelName, props: modelData});
  }

  function AddModel(name, data) {
    if( !data ) {
      throw Error('Invalid Modeldata passed');
    }
    if( !name || name === '' )  {
      if( data && data.id ) {
        name = data.id;
      } else {
        throw Error('Model should have either name or id property.');
      }
    }

    var modelObj = new Model(name, data);

    ModelStore[name] = modelObj;
  }
  function GetModelStore() {
    return ModelStore;
  }
  function GetModelNames() {
    return Object.keys(ModelStore);
  }

  ZSDKModelManager.Init = Init;
  ZSDKModelManager.AddModel = AddModel;
  ZSDKModelManager.GetModelStore = GetModelStore;
  ZSDKModelManager.GetModelNames = GetModelNames;

  return ZSDKModelManager;
})(window.ZSDKModelManager || {});

var ZSDKEventManager = (function(ZSDKEventManager) {

  var Logger = ZSDKUtil.getLogger();
  // Private var's
  var EventListeners = {}; // Map storing all the eventnames and their Listeners 

  // Public API's
  function AttachEventListener(eventName, fn) {
    if( typeof fn !== 'function' ) {
      //TODO: Using Logger log an error message as invalid params passed. fn is expected.
      return;
    }

    if(!Array.isArray(EventListeners[eventName])) {
      EventListeners[eventName] = [];
    }
    EventListeners[eventName].push(fn);
  }

  function NotifyEventListeners(AppContext, eventName, eventData) {
    var internalEventCheck = eventName.match(/^\__[A-Za-z_]+\__$/gi);
    var isInternalEvent = Array.isArray(internalEventCheck) && internalEventCheck.length > 0;

    var bindedListeners = EventListeners[eventName];
    if (bindedListeners && Array.isArray(bindedListeners) ) {
      for (var i = 0; i < bindedListeners.length; i++) {
        var fn = bindedListeners[i];
        fn.call(AppContext, eventData);
      }
    } else {
      Logger.Info('Cannot find EventListeners for Event : ', eventName);
    }
  }
  
  function NotifyInternalEventHandler(SDKContext, payload) {
    var eventName = payload.eventName;

    if( eventName === '__APP_INIT__' ) {
      SDKContext.SetContext(payload.data);
      SDKContext.ExecuteLoadHandler();

    } else if( eventName === '__APP_CONTEXT_UPDATE__' ) {
      SDKContext.UpdateContext(payload.data);
      SDKContext.ExecuteContextUpdateHandler();
    }
  }


  ZSDKEventManager.AttachEventListener = AttachEventListener;
  ZSDKEventManager.NotifyEventListeners = NotifyEventListeners;
  ZSDKEventManager.NotifyInternalEventHandler = NotifyInternalEventHandler;

  return ZSDKEventManager;
})(window.ZSDKEventManager || {});

;function ZSDK() { // TODO: Replace console with Logger

  /* Private variables */
  var that = this;
  var AppCode; // Fn which gets executed on OnLoad 
  var ContextUpdateHandler; // Fn which executed on OnContextUpdate
  var connectors;
  var QueryParams;
  var uniqueID;
  var paramsObj = {}; //TODO: Pass params from Framework to patchString in API Request call
  var localeResource = {};

  var Logger = ZSDKUtil.getLogger();

  /* Instance variables */
  this.isContextReady = false;
  this.HelperContext = {}; // Helper context for helper js files
  this.isDevMode = false;
  this.getContext = function() {
    return AppContext;
  }

  var AppContext = {}; // App context having all the 

  AppContext.Model = {}; // Modeldata store

  AppContext.Event = {}; // Event API's
  AppContext.Event.Listen = AttachEventListener;
  AppContext.Event.Trigger = TriggerEvent; // TODO: Need to check with API name and handler mechanism.

  AppContext.GetRequest = GetRequest;
  AppContext.QueryParams = QueryParams;
  AppContext.Translate = Translate;

  this.OnLoad = function (AppLoadHandler) {

    //TODO: Have to check whether AppCode has been executed. Throw Error when trying to Again bind fn to Init.
    if (typeof AppLoadHandler !== 'function') {
      throw new Error('Invalid Function value is passed');
    }

    AppCode = AppLoadHandler;
  }
  this.OnUnLoad = function(AppUnLoadHandler) {
    // TODO: Yet to impl
  }
  this.OnContextUpdate = function(AppCtxUpdateHandler) {
    // TODO: Yet to impl
    ContextUpdateHandler = AppCtxUpdateHandler;
  }

  function ExecuteLoadHandler() {
    AppCode.call(AppContext, AppContext);
  }
  function ExecuteContextUpdateHandler() {
    ContextUpdateHandler.call(AppContext, AppContext);
  }

  //TODO: Add support for Setting custom headers and other error handling cases.
  function GetRequest(options) {
    return ZSDKMessageManager.SendRequest(options);
  }

  // TODO: Need to revisit
  function TriggerEvent(eventName, payload, isPromise) {
    return ZSDKMessageManager.TriggerEvent(eventName, payload, isPromise);
  }
  function RegisterClient() {
    ZSDKMessageManager.RegisterApp();
  }

  // LoadContext object
  function SetContext(contextData) {
    Logger.Info('Setting AppContext data');

    var modelData = (contextData && contextData['model']) || {};
    var local = contextData && contextData['locale'];
    var localResource = contextData && contextData['localeResource'];

    if(isDevMode) {
      if( contextData.locale && contextData.localeResource && 
          Object.keys(contextData.localeResource).length === 0 && 
          contextData.localeResource.constructor === Object) {
        if(contextData.locale) {
          LoadLocaleResource(contextData.locale);
        }
      }
    }

    if( ZSDKModelManager ) {

      for (var key in modelData) {
        ZSDKModelManager.AddModel(key, modelData[key]);
      }
      AppContext.Model = ZSDKModelManager.GetModelStore();
    }

    // Setting the uniqueID
    uniqueID = contextData.uniqueID;

    //TODO: Need to check wheather needed or move to respective place.
    connectors = contextData.connectors;
    Logger.Info('App Connectors ', connectors);

  }
  function getUniqueID() {
    return uniqueID;
  }
  function UpdateContext(contextData) {
    //Logger.Info('Context Update Event Data ', contextData); 
  }
  function AttachEventListener(eventName, eventHandlerFn) {
    ZSDKEventManager.AttachEventListener(eventName, eventHandlerFn);
  }

  function GetConnectors() {
    return connectors;
  }

  function LoadLocaleResource(locale) {
    _loadJSON('/app-translations/'+ locale +'.json', function(response) {
      // Parse JSON string into object
      localeResource = JSON.parse(response);
      InitI18n();
    });
  }

  function _loadJSON(filepath, callback) {
    var xobj = new XMLHttpRequest();
    //xobj.overrideMimeType("application/json");
    xobj.open('GET', filepath, false); //make 3rd param true for asynchronous mode
    xobj.onreadystatechange = function () { 
      if (xobj.readyState == 4 && xobj.status == "200") {
        // Required use of an anonymous callback as .open will NOT return a value but simply returns undefined in asynchronous mode
        callback(xobj.responseText);
      }
    };
    
    xobj.send(null);  
  }

  function Translate(key, options) {
    var valStr = '';
    if(key) {
      valStr = _getKeyByString(localeResource, key);
    } 
   
    if( ! valStr) {
      return false;
    }

    if(options) {
      var key;
      var translateOptions = JSON.parse(JSON.stringify(eval(options)));
      var keysArr = Object.keys(translateOptions);
      for(key in keysArr) {
        valStr = _replaceString(valStr, '${'+ keysArr[key] +'}', translateOptions[keysArr[key]]);
      }
    }

    return valStr;
  }

  function _replaceString(str, find, replace) {
    var $r="";
    while($r!=str){ 
        $r = str;
        str = str.replace(find, replace);
    }
    return str;
  }

  function _getKeyByString(o, s) {
    s = s.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties
    s = s.replace(/^\./, '');           // strip a leading dot
    var a = s.split('.');
    for (var i = 0, n = a.length; i < n; ++i) {
        var k = a[i];
        if (k in o) {
            o = o[k];
        } else {
            return;
        }
    }
    return o;
  }

  function InitI18n() {
    var all = document.querySelectorAll('[data-i18n]');  
    for (var i in all) {
      if (all.hasOwnProperty(i)) {
        var valStr = _getKeyByString(localeResource, all[i].getAttribute('data-i18n')); 
        if( ! valStr) {
          return false;
        }

        if(all[i].hasAttribute('data-options')) {
          var options = JSON.parse(JSON.stringify(eval("(" + all[i].getAttribute('data-options') + ")")));
          var keysArr = Object.keys(options);
          var key;
          for(key in keysArr) {
            valStr = _replaceString(valStr, '${'+ keysArr[key] +'}', options[keysArr[key]]);
          }
        }
        all[i].innerHTML = valStr;
      }
    }
  }

  function Bootstrap() {
    QueryParams = ZSDKUtil.GetQueryParams();

    // Intialize variables
    isDevMode = !!QueryParams.isDevMode;
    
    var SDKContext = {};
    SDKContext.isDevMode = isDevMode;
    SDKContext.ExecuteLoadHandler = ExecuteLoadHandler;
    SDKContext.SetContext = SetContext;
    SDKContext.UpdateContext = UpdateContext;
    SDKContext.QueryParams = QueryParams;
    SDKContext.GetConnectors = GetConnectors;
    SDKContext.TriggerEvent = TriggerEvent;
    SDKContext.ExecuteContextUpdateHandler = ExecuteContextUpdateHandler;
    SDKContext.getUniqueID = getUniqueID;

    // Initiating Message Manager
    var MessageHandler = ZSDKMessageManager.Init(SDKContext);
    window.addEventListener('message', MessageHandler);
    window.addEventListener('unload', function() {
      ZSDKMessageManager.DERegisterApp();
    });

    if( ZSDKModelManager ) {
      ZSDKModelManager.Init(SDKContext);
    }

    RegisterClient();
  }

  Bootstrap(); // Bootstrap for SDK
};

