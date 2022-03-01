 /*global define*/

 // Workaround to avoid requirejs error
 if ('undefined' === typeof (define)) {
  !function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).bugsnag=e()}}(function(){function e(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function t(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function n(){return H((Math.random()*Y<<0).toString(W),G)}function r(){return z=z<Y?z:0,++z-1}function o(){return"c"+(new Date).getTime().toString(W)+H(r().toString(W),G)+X()+(n()+n())}function i(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function a(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function s(e){var t=[e.tagName];if(e.id&&t.push("#"+e.id),e.className&&e.className.length&&t.push("."+e.className.split(" ").join(".")),!document.querySelectorAll||!Array.prototype.indexOf)return t.join("");try{if(1===document.querySelectorAll(t.join("")).length)return t.join("")}catch(r){return t.join("")}if(e.parentNode.childNodes.length>1){var n=Array.prototype.indexOf.call(e.parentNode.childNodes,e)+1;t.push(":nth-child("+n+")")}return 1===document.querySelectorAll(t.join("")).length?t.join(""):e.parentNode?s(e.parentNode)+" > "+t.join(""):t.join("")}function u(e,t){return e&&e.length<=t?e:e.slice(0,t-"(...)".length)+"(...)"}function c(e){return l(e,"",[],null),JSON.stringify(e)}function f(e,t,n){this.val=e,this.k=t,this.parent=n,this.count=1}function l(e,t,n,r){if("object"==typeof e&&null!==e){if("function"==typeof e.toJSON){if(e instanceof f)return void e.count++;if(e.toJSON.forceDecirc===undefined)return}for(var o=0;o<n.length;o++)if(n[o]===e)return void(r[t]=new f(e,t,r));n.push(e);for(var i in e)Object.prototype.hasOwnProperty.call(e,i)&&l(e[i],i,n,e);n.pop()}}var d=function(e,t,n){for(var r=n,o=0,i=e.length;o<i;o++)r=t(r,e[o],o,e);return r},g=!{toString:null}.propertyIsEnumerable("toString"),p=["toString","toLocaleString","valueOf","hasOwnProperty","isPrototypeOf","propertyIsEnumerable","constructor"],h=function(e){return e<10?"0"+e:e},m={map:function(e,t){return d(e,function(e,n,r,o){return e.concat(t(n,r,o))},[])},reduce:d,filter:function(e,t){return d(e,function(e,n,r,o){return t(n,r,o)?e.concat(n):e},[])},includes:function(e,t){return d(e,function(e,n,r,o){return!0===e||n===t},!1)},keys:function(e){var t=[],n=void 0;for(n in e)Object.prototype.hasOwnProperty.call(e,n)&&t.push(n);if(!g)return t;for(var r=0,o=p.length;r<o;r++)Object.prototype.hasOwnProperty.call(e,p[r])&&t.push(p[r]);return t},isArray:function(e){return"[object Array]"===Object.prototype.toString.call(e)},isoDate:function(){var e=new Date;return e.getUTCFullYear()+"-"+h(e.getUTCMonth()+1)+"-"+h(e.getUTCDate())+"T"+h(e.getUTCHours())+":"+h(e.getUTCMinutes())+":"+h(e.getUTCSeconds())+"."+(e.getUTCMilliseconds()/1e3).toFixed(3).slice(2,5)+"Z"}},v=m.isoDate,y=function(){function t(){var n=arguments.length>0&&arguments[0]!==undefined?arguments[0]:"[anonymous]",r=arguments.length>1&&arguments[1]!==undefined?arguments[1]:{},o=arguments.length>2&&arguments[2]!==undefined?arguments[2]:"manual",i=arguments.length>3&&arguments[3]!==undefined?arguments[3]:v();e(this,t),this.type=o,this.name=n,this.metaData=r,this.timestamp=i}return t.prototype.toJSON=function(){return{type:this.type,name:this.name,timestamp:this.timestamp,metaData:this.metaData}},t}();y.prototype.toJSON.forceDecirc=!0;var b=y,w=m.includes,S=function(e){return w(["undefined","number"],typeof e)&&parseInt(""+e,10)===e&&e>0},O={},E=m.filter,N=m.reduce,j=m.keys,R=m.isArray;O.schema={apiKey:{defaultValue:function(){return null},message:"(string) apiKey is required",validate:function(e){return"string"==typeof e&&e.length}},appVersion:{defaultValue:function(){return null},message:"(string) appVersion should have a value if supplied",validate:function(e){return null===e||"string"==typeof e&&e.length}},autoNotify:{defaultValue:function(){return!0},message:"(boolean) autoNotify should be true or false",validate:function(e){return!0===e||!1===e}},beforeSend:{defaultValue:function(){return[]},message:"(array[Function]) beforeSend should only contain functions",validate:function(e){return"function"==typeof e||R(e)&&E(e,function(e){return"function"==typeof e}).length===e.length}},endpoint:{defaultValue:function(){return"https://notify.bugsnag.com"},message:"(string) endpoint should be set",validate:function(){return!0}},sessionEndpoint:{defaultValue:function(){return"https://sessions.bugsnag.com"},message:"(string) sessionEndpoint should be set",validate:function(){return!0}},autoCaptureSessions:{defaultValue:function(){return!1},message:"(boolean) autoCaptureSessions should be true/false",validate:function(e){return!0===e||!1===e}},notifyReleaseStages:{defaultValue:function(){return null},message:"(array[string]) notifyReleaseStages should only contain strings",validate:function(e){return null===e||R(e)&&E(e,function(e){return"string"==typeof e}).length===e.length}},releaseStage:{defaultValue:function(){return"production"},message:"(string) releaseStage should be set",validate:function(e){return"string"==typeof e&&e.length}},maxBreadcrumbs:{defaultValue:function(){return 20},message:"(number) maxBreadcrumbs must be a number (≤40) if specified",validate:function(e){return 0===e||S(e)&&(e===undefined||e<=40)}},autoBreadcrumbs:{defaultValue:function(){return!0},message:"(boolean) autoBreadcrumbs should be true or false",validate:function(e){return"boolean"==typeof e}},user:{defaultValue:function(){return null},message:"(object) user should be an object",validate:function(e){return"object"==typeof e}},metaData:{defaultValue:function(){return null},message:"(object) metaData should be an object",validate:function(e){return"object"==typeof e}}},O.mergeDefaults=function(e,t){if(!e||!t)throw new Error("schema.mergeDefaults(opts, schema): opts and schema objects are required");return N(j(t),function(n,r){return n[r]=e[r]!==undefined?e[r]:t[r].defaultValue(),n},{})},O.validate=function(e,t){if(!e||!t)throw new Error("schema.mergeDefaults(opts, schema): opts and schema objects are required");var n=N(j(t),function(n,r){return t[r].validate(e[r])?n:n.concat({key:r,message:t[r].message,value:e[r]})},[]);return{valid:!n.length,errors:n}};var D=function(e){return e.app&&"string"==typeof e.app.releaseStage?e.app.releaseStage:e.config.releaseStage},k=function(e){return!(!e||!e.stack&&!e.stacktrace&&!e["opera#sourceloc"]||"string"!=typeof(e.stack||e.stacktrace||e["opera#sourceloc"]))},B={};!function(e,t){"use strict";"object"==typeof B?B=t():e.StackFrame=t()}(this,function(){"use strict";function e(e){return!isNaN(parseFloat(e))&&isFinite(e)}function t(e){return e.charAt(0).toUpperCase()+e.substring(1)}function n(e){return function(){return this[e]}}function r(e){if(e instanceof Object)for(var n=0;n<u.length;n++)e.hasOwnProperty(u[n])&&e[u[n]]!==undefined&&this["set"+t(u[n])](e[u[n]])}var o=["isConstructor","isEval","isNative","isToplevel"],i=["columnNumber","lineNumber"],a=["fileName","functionName","source"],s=["args"],u=o.concat(i,a,s);r.prototype={getArgs:function(){return this.args},setArgs:function(e){if("[object Array]"!==Object.prototype.toString.call(e))throw new TypeError("Args must be an Array");this.args=e},getEvalOrigin:function(){return this.evalOrigin},setEvalOrigin:function(e){if(e instanceof r)this.evalOrigin=e;else{if(!(e instanceof Object))throw new TypeError("Eval Origin must be an Object or StackFrame");this.evalOrigin=new r(e)}},toString:function(){return(this.getFunctionName()||"{anonymous}")+("("+(this.getArgs()||[]).join(",")+")")+(this.getFileName()?"@"+this.getFileName():"")+(e(this.getLineNumber())?":"+this.getLineNumber():"")+(e(this.getColumnNumber())?":"+this.getColumnNumber():"")}};for(var c=0;c<o.length;c++)r.prototype["get"+t(o[c])]=n(o[c]),r.prototype["set"+t(o[c])]=function(e){return function(t){this[e]=Boolean(t)}}(o[c]);for(var f=0;f<i.length;f++)r.prototype["get"+t(i[f])]=n(i[f]),r.prototype["set"+t(i[f])]=function(t){return function(n){if(!e(n))throw new TypeError(t+" must be a Number");this[t]=Number(n)}}(i[f]);for(var l=0;l<a.length;l++)r.prototype["get"+t(a[l])]=n(a[l]),r.prototype["set"+t(a[l])]=function(e){return function(t){this[e]=String(t)}}(a[l]);return r});var x={};!function(e,t){"use strict";"object"==typeof x?x=t(B):e.ErrorStackParser=t(e.StackFrame)}(this,function(e){"use strict";var t=/(^|@)\S+\:\d+/,n=/^\s*at .*(\S+\:\d+|\(native\))/m,r=/^(eval@)?(\[native code\])?$/;return{parse:function(e){if("undefined"!=typeof e.stacktrace||"undefined"!=typeof e["opera#sourceloc"])return this.parseOpera(e);if(e.stack&&e.stack.match(n))return this.parseV8OrIE(e);if(e.stack)return this.parseFFOrSafari(e);throw new Error("Cannot parse given Error object")},extractLocation:function(e){if(-1===e.indexOf(":"))return[e];var t=/(.+?)(?:\:(\d+))?(?:\:(\d+))?$/.exec(e.replace(/[\(\)]/g,""));return[t[1],t[2]||undefined,t[3]||undefined]},parseV8OrIE:function(t){return t.stack.split("\n").filter(function(e){return!!e.match(n)},this).map(function(t){t.indexOf("(eval ")>-1&&(t=t.replace(/eval code/g,"eval").replace(/(\(eval at [^\()]*)|(\)\,.*$)/g,""));var n=t.replace(/^\s+/,"").replace(/\(eval code/g,"(").split(/\s+/).slice(1),r=this.extractLocation(n.pop()),o=n.join(" ")||undefined,i=["eval","<anonymous>"].indexOf(r[0])>-1?undefined:r[0];return new e({functionName:o,fileName:i,lineNumber:r[1],columnNumber:r[2],source:t})},this)},parseFFOrSafari:function(t){return t.stack.split("\n").filter(function(e){return!e.match(r)},this).map(function(t){if(t.indexOf(" > eval")>-1&&(t=t.replace(/ line (\d+)(?: > eval line \d+)* > eval\:\d+\:\d+/g,":$1")),-1===t.indexOf("@")&&-1===t.indexOf(":"))return new e({functionName:t});var n=t.split("@"),r=this.extractLocation(n.pop()),o=n.join("@")||undefined;return new e({functionName:o,fileName:r[0],lineNumber:r[1],columnNumber:r[2],source:t})},this)},parseOpera:function(e){return!e.stacktrace||e.message.indexOf("\n")>-1&&e.message.split("\n").length>e.stacktrace.split("\n").length?this.parseOpera9(e):e.stack?this.parseOpera11(e):this.parseOpera10(e)},parseOpera9:function(t){for(var n=/Line (\d+).*script (?:in )?(\S+)/i,r=t.message.split("\n"),o=[],i=2,a=r.length;i<a;i+=2){var s=n.exec(r[i]);s&&o.push(new e({fileName:s[2],lineNumber:s[1],source:r[i]}))}return o},parseOpera10:function(t){for(var n=/Line (\d+).*script (?:in )?(\S+)(?:: In function (\S+))?$/i,r=t.stacktrace.split("\n"),o=[],i=0,a=r.length;i<a;i+=2){var s=n.exec(r[i]);s&&o.push(new e({functionName:s[3]||undefined,fileName:s[2],lineNumber:s[1],source:r[i]}))}return o},parseOpera11:function(n){return n.stack.split("\n").filter(function(e){return!!e.match(t)&&!e.match(/^Error created at/)},this).map(function(t){var n,r=t.split("@"),o=this.extractLocation(r.pop()),i=r.shift()||"",a=i.replace(/<anonymous function(: (\w+))?>/,"$2").replace(/\([^\)]*\)/g,"")||undefined;i.match(/\(([^\)]*)\)/)&&(n=i.replace(/^[^\(]+\(([^\)]*)\)$/,"$1"));var s=n===undefined||"[arguments not available]"===n?undefined:n.split(",");return new e({functionName:a,args:s,fileName:o[0],lineNumber:o[1],columnNumber:o[2],source:t})},this)}}});var _={};!function(e,t){"use strict";"object"==typeof _?_=t(B):e.StackGenerator=t(e.StackFrame)}(this,function(e){return{backtrace:function(t){var n=[],r=10;"object"==typeof t&&"number"==typeof t.maxStackSize&&(r=t.maxStackSize);for(var o=arguments.callee;o&&n.length<r&&o.arguments;){for(var i=new Array(o.arguments.length),a=0;a<i.length;++a)i[a]=o.arguments[a];/function(?:\s+([\w$]+))+\s*\(/.test(o.toString())?n.push(new e({functionName:RegExp.$1||undefined,args:i})):n.push(new e({args:i}));try{o=o.caller}catch(s){break}}return n}}});var C=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},T=m.reduce,L=m.filter,q=function(){function e(n,r){var o=arguments.length>2&&arguments[2]!==undefined?arguments[2]:[],i=arguments.length>3&&arguments[3]!==undefined?arguments[3]:P();t(this,e),this.__isBugsnagReport=!0,this._ignored=!1,this._handledState=i,this.app=undefined,this.apiKey=undefined,this.breadcrumbs=[],this.context=undefined,this.device=undefined,this.errorClass=V(n,"[no error class]"),this.errorMessage=V(r,"[no error message]"),this.groupingHash=undefined,this.metaData={},this.request=undefined,this.severity=this._handledState.severity,this.stacktrace=T(o,function(e,t){var n=A(t);try{return"{}"===JSON.stringify(n)?e:e.concat(n)}catch(r){return e}},[]),this.user=undefined,this.session=undefined}return e.prototype.ignore=function(){this._ignored=!0},e.prototype.isIgnored=function(){return this._ignored},e.prototype.updateMetaData=function(e){var t;if(!e)return this;var n=void 0;return null===(arguments.length<=1?undefined:arguments[1])?this.removeMetaData(e):null===(arguments.length<=2?undefined:arguments[2])?this.removeMetaData(e,arguments.length<=1?undefined:arguments[1],arguments.length<=2?undefined:arguments[2]):("object"==typeof(arguments.length<=1?undefined:arguments[1])&&(n=arguments.length<=1?undefined:arguments[1]),"string"==typeof(arguments.length<=1?undefined:arguments[1])&&(t={},t[arguments.length<=1?undefined:arguments[1]]=arguments.length<=2?undefined:arguments[2],n=t),n?(this.metaData[e]||(this.metaData[e]={}),this.metaData[e]=C({},this.metaData[e],n),this):this)},e.prototype.removeMetaData=function(e,t){return"string"!=typeof e?this:t?this.metaData[e]?(delete this.metaData[e][t],this):this:(delete this.metaData[e],this)},e.prototype.toJSON=function(){return{payloadVersion:"4",exceptions:[{errorClass:this.errorClass,message:this.errorMessage,stacktrace:this.stacktrace,type:"browserjs"}],severity:this.severity,unhandled:this._handledState.unhandled,severityReason:this._handledState.severityReason,app:this.app,device:this.device,breadcrumbs:this.breadcrumbs,context:this.context,user:this.user,metaData:this.metaData,groupingHash:this.groupingHash,request:this.request,session:this.session}},e}();q.prototype.toJSON.forceDecirc=!0;var A=function(e){var t={file:e.fileName,method:M(e.functionName),lineNumber:e.lineNumber,columnNumber:e.columnNumber,code:undefined,inProject:undefined};return t.lineNumber>-1&&!t.file&&!t.method&&(t.file="global code"),t},M=function(e){return/^global code$/i.test(e)?"global code":e},P=function(){return{unhandled:!1,severity:"warning",severityReason:{type:"handledException"}}},V=function(e,t){return"string"==typeof e&&e?e:t};q.getStacktrace=function(e){var t=arguments.length>1&&arguments[1]!==undefined?arguments[1]:0,n=arguments.length>2&&arguments[2]!==undefined?arguments[2]:0;return k(e)?x.parse(e).slice(t):L(_.backtrace(),function(e){return-1===(e.functionName||"").indexOf("StackGenerator$$")}).slice(1+n)},q.ensureReport=function(e){var t=arguments.length>1&&arguments[1]!==undefined?arguments[1]:0,n=arguments.length>2&&arguments[2]!==undefined?arguments[2]:0;if(e.__isBugsnagReport)return e;try{var r=q.getStacktrace(e,t,1+n);return new q(e.name,e.message,r)}catch(o){return new q(e.name,e.message,[])}};var U=q,H=function(e,t){var n="000000000"+e;return n.substr(n.length-t)},$="object"==typeof window?window:self,F=0;for(var I in $)Object.hasOwnProperty.call($,I)&&F++;var K=navigator.mimeTypes?navigator.mimeTypes.length:0,J=H((K+navigator.userAgent.length).toString(36)+F.toString(36),4),X=function(){return J},z=0,G=4,W=36,Y=Math.pow(W,G);o.fingerprint=X;var Z=o,Q=m.isoDate,ee=function(){function e(){i(this,e),this.id=Z(),this.startedAt=Q(),this._handled=0,this._unhandled=0}return e.prototype.toJSON=function(){return{id:this.id,startedAt:this.startedAt,events:{handled:this._handled,unhandled:this._unhandled}}},e.prototype.trackError=function(e){this[e._handledState.unhandled?"_unhandled":"_handled"]+=1},e}();ee.prototype.toJSON.forceDecirc=!0;var te=ee,ne=function(e){switch(Object.prototype.toString.call(e)){case"[object Error]":case"[object Exception]":case"[object DOMException]":return!0;default:return e instanceof Error}},re=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},oe=m.map,ie=m.reduce,ae=m.includes,se=m.isArray,ue=function(){},ce=function(){function e(t){var n=arguments.length>1&&arguments[1]!==undefined?arguments[1]:O.schema,r=arguments.length>2&&arguments[2]!==undefined?arguments[2]:null;if(a(this,e),!t)throw new Error("new BugsnagClient(notifier, configSchema) requires `notifier` argument");if(!t.name||!t.version||!t.url)throw new Error("new BugsnagClient(notifier, configSchema) - `notifier` requires: `{ name, version, url }`");this.notifier=t,this.configSchema=n,this._configured=!1,this._transport={name:"NULL_TRANSPORT",sendSession:ue,sendReport:ue},this._logger={debug:ue,info:ue,warn:ue,error:ue},this.plugins=[],this.session=r,this.beforeSession=[],this.breadcrumbs=[],this.app={},this.context=undefined,this.device=undefined,this.metaData=undefined,this.request=undefined,this.user={},this.BugsnagReport=U,this.BugsnagBreadcrumb=b,this.BugsnagSession=te}return e.prototype.configure=function(){var e=arguments.length>0&&arguments[0]!==undefined?arguments[0]:{};this.config=O.mergeDefaults(re({},this.config,e),this.configSchema);var t=O.validate(this.config,this.configSchema);if(!0==!t.valid){var n=new Error("Bugsnag configuration error");throw n.errors=oe(t.errors,function(e){return e.key+" "+e.message+" \n  "+e.value}),n}return"function"==typeof this.config.beforeSend&&(this.config.beforeSend=[this.config.beforeSend]),null!==this.config.appVersion&&(this.app.version=this.config.appVersion),this.config.metaData&&(this.metaData=this.config.metaData),this.config.user&&(this.user=this.config.user),this._configured=!0,this._logger.debug("Loaded!"),this},e.prototype.use=function(e){return this.plugins.push(e),e.init(this)},e.prototype.transport=function(e){return this._transport=e,this},e.prototype.logger=function(e,t){return this._logger=e,this},e.prototype.sessionDelegate=function(e){return this._sessionDelegate=e,this},e.prototype.startSession=function(){return this._sessionDelegate?this._sessionDelegate.startSession(this):(this._logger.warn("No session implementation is installed"),this)},e.prototype.leaveBreadcrumb=function(e,t,n,r){if(!this._configured)throw new Error("Bugsnag must be configured before calling leaveBreadcrumb()");if(e=e||undefined,n="string"==typeof n?n:undefined,r="string"==typeof r?r:undefined,t="object"==typeof t&&null!==t?t:undefined,"string"==typeof e||t){var o=new b(e,t,n,r);return this.breadcrumbs.push(o),this.breadcrumbs.length>this.config.maxBreadcrumbs&&(this.breadcrumbs=this.breadcrumbs.slice(this.breadcrumbs.length-this.config.maxBreadcrumbs)),this}},e.prototype.notify=function(e){var t=arguments.length>1&&arguments[1]!==undefined?arguments[1]:{};if(!this._configured)throw new Error("Bugsnag must be configured before calling report()");var n=D(this),r=fe(e,t,this._logger),o=r.err,i=r.errorFramesToSkip,a=r._opts;a&&(t=a),o||(this._logger.warn('Usage error. notify() called with no "error" parameter'),o=new Error('Bugsnag usage error. notify() called with no "error" parameter')),"object"==typeof t&&null!==t||(t={});var s=U.ensureReport(o,i,1);if(s.app=re({releaseStage:n},s.app,this.app),s.context=s.context||t.context||this.context||undefined,s.device=re({},s.device,this.device,t.device),s.request=re({},s.request,this.request,t.request),s.user=re({},s.user,this.user,t.user),s.metaData=re({},s.metaData,this.metaData,t.metaData),s.breadcrumbs=this.breadcrumbs.slice(0),this.session&&(this.session.trackError(s),s.session=this.session),t.severity!==undefined&&(s.severity=t.severity,s._handledState.severityReason={type:"userSpecifiedSeverity"}),se(this.config.notifyReleaseStages)&&!ae(this.config.notifyReleaseStages,n))return this._logger.warn("Report not sent due to releaseStage/notifyReleaseStages configuration"),!1;var u=s.severity,c=[].concat(t.beforeSend).concat(this.config.beforeSend);return ie(c,function(e,t){return!0===e||("function"==typeof t&&!1===t(s)||!!s.isIgnored())},!1)?(this._logger.debug("Report not sent due to beforeSend callback"),!1):(this.config.autoBreadcrumbs&&this.leaveBreadcrumb(s.errorClass,{errorClass:s.errorClass,errorMessage:s.errorMessage,severity:s.severity,stacktrace:s.stacktrace},"error"),u!==s.severity&&(s._handledState.severityReason={type:"userCallbackSetSeverity"}),this._transport.sendReport(this._logger,this.config,{apiKey:s.apiKey||this.config.apiKey,notifier:this.notifier,events:[s]}),!0)},e}(),fe=function(e,t,n){var r=void 0,o=0,i=void 0;switch(typeof e){case"string":"string"==typeof t?(n.warn("Usage error. notify() called with (string, string) but expected (error, object)"),r=new Error("Bugsnag usage error. notify() called with (string, string) but expected (error, object)"),i={metaData:{notifier:{notifyArgs:[e,t]}}}):(r=new Error(String(e)),o+=2);break;case"number":case"boolean":r=new Error(String(e));break;case"function":n.warn('Usage error. notify() called with a function as "error" parameter'),r=new Error('Bugsnag usage error. notify() called with a function as "error" parameter');break;case"object":null!==e&&(ne(e)||e.__isBugsnagReport)?r=e:null!==e&&le(e)?((r=new Error(e.message||e.errorMessage)).name=e.name||e.errorClass,o+=2):(n.warn('Usage error. notify() called with an unsupported object as "error" parameter. Supply an Error or { name, message } object.'),r=new Error('Bugsnag usage error. notify() called with an unsupported object as "error" parameter. Supply an Error or { name, message } object.'))}return{err:r,errorFramesToSkip:o,_opts:i}},le=function(e){return!("string"!=typeof e.name&&"string"!=typeof e.errorClass||"string"!=typeof e.message&&"string"!=typeof e.errorMessage)},de=ce,ge={init:function(e){var t=0;e.config.beforeSend.push(function(n){if(t>=e.config.maxEvents)return n.ignore();t++}),e.refresh=function(){t=0}},configSchema:{maxEvents:{defaultValue:function(){return 10},message:"(number) maxEvents must be a positive integer ≤100",validate:function(e){return S(e)&&e<100}}}},pe={releaseStage:{defaultValue:function(){return/^localhost(:\d+)?$/.test(window.location.host)?"development":"production"},message:"(string) releaseStage should be set",validate:function(e){return"string"==typeof e&&e.length}},collectUserIp:{defaultValue:function(){return!0},message:"(boolean) collectUserIp should true/false",validate:function(e){return!0===e||!1===e}}},he=m.map,me=m.reduce,ve={init:function(e){he(ye,function(t){var n=console[t];console[t]=function(){for(var r=arguments.length,o=Array(r),i=0;i<r;i++)o[i]=arguments[i];e.leaveBreadcrumb("Console output",me(o,function(e,t,n){var r=String(t);if("[object Object]"===r)try{r=JSON.stringify(t)}catch(o){}return e["["+n+"]"]=r,e},{severity:0===t.indexOf("group")?"log":t}),"log"),n.apply(console,o)},console[t]._restore=function(){console[t]=n}})},destroy:function(){return ye.forEach(function(e){"function"==typeof console[e]._restore&&console[e]._restore()})},configSchema:{consoleBreadcrumbsEnabled:{defaultValue:function(){return undefined},validate:function(e){return!0===e||!1===e||e===undefined},message:"(boolean) consoleBreadcrumbsEnabled should be true or false"}}},ye=(0,m.filter)(["log","debug","info","warn","error"],function(e){return"undefined"!=typeof console&&"function"==typeof console[e]}),be={init:function(e){e.config.beforeSend.unshift(function(e){e.context||(e.context=window.location.pathname)})}},we=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},Se=m.isoDate,Oe={init:function(e){e.config.beforeSend.unshift(function(e){e.device=we({time:Se(),locale:navigator.browserLanguage||navigator.systemLanguage||navigator.userLanguage||navigator.language,userAgent:navigator.userAgent},e.device)}),e.beforeSession.push(function(e){e.device={userAgent:navigator.userAgent}})}},Ee={},Ne=m.reduce,je=/^.*<script.*?>/,Re=/<\/script>.*$/,De=(Ee={init:function(e){var t="",n=!1,r=function(){return document.documentElement.outerHTML},o=window.location.href;t=r(),document.onreadystatechange=function(){"interactive"===document.readyState&&(t=r(),n=!0)},e.config.beforeSend.unshift(function(e){var i=e.stacktrace[0];if(!i||!i.file||!i.lineNumber)return i;if(i.file.replace(/#.*$/,"")!==o.replace(/#.*$/,""))return i;n&&t||(t=r());var a=["\x3c!-- DOCUMENT START --\x3e"].concat(t.split("\n")),s=De(a,i.lineNumber-1),u=s.script,c=s.start,f=Ne(u,function(e,t,n){return Math.abs(c+n+1-i.lineNumber)>10?e:(e[""+(c+n+1)]=t,e)},{});i.code=f,e.updateMetaData("script",{content:u.join("\n")})})}}).extractScriptContent=function(e,t){for(var n=t;n<e.length&&!Re.test(e[n]);)n++;for(var r=n;n>0&&!je.test(e[n]);)n--;var o=n,i=e.slice(o,r+1);return i[0]=i[0].replace(je,""),i[i.length-1]=i[i.length-1].replace(Re,""),{script:i,start:o}},ke={init:function(e){"addEventListener"in window&&window.addEventListener("click",function(t){var n=void 0,r=void 0;try{n=Be(t.target),r=s(t.target)}catch(o){n="[hidden]",r="[hidden]",e._logger.error("Cross domain error when tracking click event. See https://docs.bugsnag.com/platforms/browsers/faq/#3-cross-origin-script-errors")}e.leaveBreadcrumb("UI click",{targetText:n,targetSelector:r},"user")},!0)},configSchema:{interactionBreadcrumbsEnabled:{defaultValue:function(){return undefined},validate:function(e){return!0===e||!1===e||e===undefined},message:"(boolean) interactionBreadcrumbsEnabled should be true or false"}}},Be=function(e){var t=e.textContent||e.innerText||"";return t||"submit"!==e.type&&"button"!==e.type||(t=e.value),t=t.replace(/^\s+|\s+$/g,""),u(t,140)},xe=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},_e={init:function(e){e.config.collectUserIp||e.config.beforeSend.push(function(e){e.user=xe({id:"[NOT COLLECTED]"},e.user),e.request=xe({clientIp:"[NOT COLLECTED]"},e.request)})}},Ce={init:function(e){if("addEventListener"in window){var t=function(t){return function(){return e.leaveBreadcrumb(t,{},"navigation")}};window.addEventListener("pagehide",t("Page hidden"),!0),window.addEventListener("pageshow",t("Page shown"),!0),window.addEventListener("load",t("Page loaded"),!0),window.document.addEventListener("DOMContentLoaded",t("DOMContentLoaded"),!0),window.addEventListener("load",function(){return window.addEventListener("popstate",t("Navigated back"),!0)}),window.addEventListener("hashchange",function(t){var n=t.oldURL?{from:Te(t.oldURL),to:Te(t.newURL),state:window.history.state}:{to:Te(window.location.href)};e.leaveBreadcrumb("Hash changed",n,"navigation")},!0),window.history.replaceState&&qe(e,window.history,"replaceState"),window.history.pushState&&qe(e,window.history,"pushState"),e.leaveBreadcrumb("Bugsnag loaded",{},"navigation")}},destroy:function(){window.history.replaceState._restore(),window.history.pushState._restore()},configSchema:{navigationBreadcrumbsEnabled:{defaultValue:function(){return undefined},validate:function(e){return!0===e||!1===e||e===undefined},message:"(boolean) navigationBreadcrumbsEnabled should be true or false"}}},Te=function(e){var t=document.createElement("A");return t.href=e,""+t.pathname+t.search+t.hash},Le=function(e,t,n){var r=Te(window.location.href);return{title:t,state:e,prevState:window.history.state,to:n||r,from:r}},qe=function(e,t,n){var r=t[n];t[n]=function(o,i,a){e.leaveBreadcrumb("History "+n,Le(o,i,a),"navigation"),"function"==typeof e.refresh&&e.refresh(),e.session&&e.startSession(),r.call(t,o,i,a)},t[n]._restore=function(){t[n]=r}},Ae=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},Me={init:function(e){e.config.beforeSend.unshift(function(e){e.request&&e.request.url||(e.request=Ae({},e.request,{url:window.location.href}))})}},Pe=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},Ve=m.map,Ue=m.isArray,He=m.includes,$e={init:function(e){return e.sessionDelegate(Fe)}},Fe={startSession:function(e){var t=e;t.session=new e.BugsnagSession,Ve(t.beforeSession,function(e){return e(t)});var n=D(t);return Ue(t.config.notifyReleaseStages)&&!He(t.config.notifyReleaseStages,n)?(t._logger.warn("Session not sent due to releaseStage/notifyReleaseStages configuration"),t):(t._transport.sendSession(t._logger,t.config,{notifier:t.notifier,device:t.device,app:Pe({releaseStage:n},t.app),sessions:[{id:t.session.id,startedAt:t.session.startedAt,user:t.user}]}),t)}},Ie={},Ke=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},Je=m.map,Xe=(Ie={init:function(e){e.config.beforeSend.push(function(e){e.stacktrace=Je(e.stacktrace,function(e){return Ke({},e,{file:Xe(e.file)})})})}})._strip=function(e){return"string"==typeof e?e.replace(/\?.*$/,"").replace(/#.*$/,""):e},ze=m.reduce,Ge=void 0,We={init:function(e){var t=function(t){var n=t.reason,r=!1;t.detail&&t.detail.reason&&(n=t.detail.reason,r=!0);var o={severity:"error",unhandled:!0,severityReason:{type:"unhandledPromiseRejection"}},i=void 0;if(n&&k(n))i=new e.BugsnagReport(n.name,n.message,x.parse(n),o),r&&(i.stacktrace=ze(i.stacktrace,Ze(n),[]));else{(i=new e.BugsnagReport(n&&n.name?n.name:"UnhandledRejection",n&&n.message?n.message:'Rejection reason was not an Error. See "Promise" tab for more detail.',[],o)).updateMetaData("promise","rejection reason",Ye(n))}e.notify(i)};"addEventListener"in window?window.addEventListener("unhandledrejection",t):window.onunhandledrejection=function(e,n){t({detail:{reason:e,promise:n}})},Ge=t},destroy:function(){Ge&&("addEventListener"in window?window.removeEventListener("unhandledrejection",Ge):window.onunhandledrejection=null),Ge=null}},Ye=function(e){if(null===e||e===undefined)return"undefined (or null)";if(ne(e)){var t;return t={},t[Object.prototype.toString.call(e)]={name:e.name,message:e.message,code:e.code,stack:e.stack},t}return e},Ze=function(e){return function(t,n){return n.file===e.toString()?t:(n.method&&(n.method=n.method.replace(/^\s+/,"")),t.concat(n))}},Qe={init:function(e){var t=window.onerror;window.onerror=function(n,r,o,i,a){if(0===o&&/Script error\.?/.test(n))e._logger.warn("Ignoring cross-domain or eval script error. See https://docs.bugsnag.com/platforms/browsers/faq/#3-cross-origin-script-errors");else{var s={severity:"error",unhandled:!0,severityReason:{type:"unhandledException"}},u=void 0;if(a)a.name&&a.message?u=new e.BugsnagReport(a.name,a.message,et(e.BugsnagReport.getStacktrace(a),r,o,i),s):(u=new e.BugsnagReport("window.onerror",String(a),et(e.BugsnagReport.getStacktrace(a,1),r,o,i),s)).updateMetaData("window onerror",{error:a});else if("object"!=typeof n||null===n||r||o||i||a)(u=new e.BugsnagReport("window.onerror",String(n),et(e.BugsnagReport.getStacktrace(a,1),r,o,i),s)).updateMetaData("window onerror",{event:n});else{var c=n.type?"Event: "+n.type:"window.onerror",f=n.message||n.detail||"";(u=new e.BugsnagReport(c,f,e.BugsnagReport.getStacktrace(new Error,1).slice(1),s)).updateMetaData("window onerror",{event:n})}e.notify(u),"function"==typeof t&&t(n,r,o,i,a)}}}},et=function(e,t,n,r){var o=e[0];return o?(o.fileName||o.setFileName(t),o.lineNumber||o.setLineNumber(n),o.columnNumber||(r!==undefined?o.setColumnNumber(r):window.event&&window.event.errorCharacter&&o.setColumnNumber(window.event&&window.event.errorCharacter)),e):e},tt=c;c["default"]=c,f.prototype.toJSON=function(){return 0==--this.count&&(this.parent[this.k]=this.val),"[Circular]"};var nt=function(e){var t=tt(e);if(t.length>1e6&&(delete e.events[0].metaData,e.events[0].metaData={notifier:"WARNING!\nThe serialized payload was "+t.length/1e6+"MB. The limit is 1MB.\nreport.metaData was stripped to make the payload of a deliverable size."},(t=tt(e)).length>1e6))throw new Error("payload exceeded 1MB limit");return t},rt={},ot=m.isoDate,it=(rt={name:"XDomainRequest",sendReport:function(e,t,n){var r=arguments.length>3&&arguments[3]!==undefined?arguments[3]:function(){},o=it(t.endpoint,window.location.protocol)+"?apiKey="+encodeURIComponent(t.apiKey)+"&payloadVersion=4.0&sentAt="+encodeURIComponent(ot()),i=new window.XDomainRequest;i.onload=function(){r(null,i.responseText)},i.open("POST",o),setTimeout(function(){try{i.send(nt(n))}catch(t){e.error(t)}},0)},sendSession:function(e,t,n){var r=arguments.length>3&&arguments[3]!==undefined?arguments[3]:function(){},o=it(t.sessionEndpoint,window.location.protocol)+"?apiKey="+encodeURIComponent(t.apiKey)+"&payloadVersion=1.0&sentAt="+encodeURIComponent(ot()),i=new window.XDomainRequest;i.onload=function(){r(null,i.responseText)},i.open("POST",o),setTimeout(function(){try{i.send(tt(n))}catch(t){e.error(t)}},0)}})._matchPageProtocol=function(e,t){return"http:"===t?e.replace(/^https:/,"http:"):e},at=m.isoDate,st={name:"XMLHttpRequest",sendReport:function(e,t,n){var r=arguments.length>3&&arguments[3]!==undefined?arguments[3]:function(){},o=t.endpoint,i=new window.XMLHttpRequest;i.onreadystatechange=function(){i.readyState===window.XMLHttpRequest.DONE&&r(null,i.responseText)},i.open("POST",o),i.setRequestHeader("Content-Type","application/json"),i.setRequestHeader("Bugsnag-Api-Key",n.apiKey||t.apiKey),i.setRequestHeader("Bugsnag-Payload-Version","4.0"),i.setRequestHeader("Bugsnag-Sent-At",at());try{i.send(nt(n))}catch(a){e.error(a)}},sendSession:function(e,t,n){var r=arguments.length>3&&arguments[3]!==undefined?arguments[3]:function(){},o=t.sessionEndpoint,i=new window.XMLHttpRequest;i.onreadystatechange=function(){i.readyState===window.XMLHttpRequest.DONE&&r(null,i.responseText)},i.open("POST",o),i.setRequestHeader("Content-Type","application/json"),i.setRequestHeader("Bugsnag-Api-Key",t.apiKey),i.setRequestHeader("Bugsnag-Payload-Version","1.0"),i.setRequestHeader("Bugsnag-Sent-At",at());try{i.send(tt(n))}catch(a){e.error(a)}}},ut={},ct=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},ft=m.map,lt=m.reduce,dt=ct({},O.schema,pe),gt=[Qe,We,Oe,be,Me,ge,ve,Ce,ke,Ee,$e,_e,Ie],pt={XDomainRequest:rt,XMLHttpRequest:st};ut=function(e){var t=arguments.length>1&&arguments[1]!==undefined?arguments[1]:[];"string"==typeof e&&(e={apiKey:e}),e.sessionTrackingEnabled&&(e.autoCaptureSessions=e.sessionTrackingEnabled);var n=lt([].concat(gt).concat(t),function(e,t){return t.configSchema?ct({},e,t.configSchema):e},dt),r=new de({name:"Bugsnag JavaScript",version:"4.4.0",url:"https://github.com/bugsnag/bugsnag-js"},n);if(r.transport(window.XDomainRequest?pt.XDomainRequest:pt.XMLHttpRequest),"undefined"!=typeof console&&"function"==typeof console.debug){var o=ht();r.logger(o)}try{r.configure(e)}catch(i){throw r._logger.warn(i),i.errors&&ft(i.errors,r._logger.warn),i}return r.use(Oe),r.use(be),r.use(Me),r.use(Ee),r.use(ge),r.use($e),r.use(_e),r.use(Ie),!1!==r.config.autoNotify&&(r.use(Qe),r.use(We)),mt(r.config,"navigationBreadcrumbsEnabled")&&r.use(Ce),mt(r.config,"interactionBreadcrumbsEnabled")&&r.use(ke),mt(r.config,"consoleBreadcrumbsEnabled",!1)&&r.use(ve),ft(t,function(e){return r.use(e)}),r.config.autoCaptureSessions?r.startSession():r};var ht=function(){var e={},t=console.log;return ft(["debug","info","warn","error"],function(n){var r=console[n];e[n]="function"==typeof r?r.bind(console,"[bugsnag]"):t.bind(console,"[bugsnag]")}),e},mt=function(e,t){var n=!(arguments.length>2&&arguments[2]!==undefined)||arguments[2];return"boolean"==typeof e[t]?e[t]:e.autoBreadcrumbs&&(n||!/^dev(elopment)?$/.test(e.releaseStage))};return ut.Bugsnag={Client:de,Report:U,Session:te,Breadcrumb:b},ut["default"]=ut,ut});
 }

"object"!=typeof JSON&&(JSON={}),function(){"use strict";function f(a){return 10>a?"0"+a:a}function quote(a){return escapable.lastIndex=0,escapable.test(a)?'"'+a.replace(escapable,function(a){var b=meta[a];return"string"==typeof b?b:"\\u"+("0000"+a.charCodeAt(0).toString(16)).slice(-4)})+'"':'"'+a+'"'}function str(a,b){var c,d,e,f,g,h=gap,i=b[a];switch(i&&"object"==typeof i&&"function"==typeof i.toJSON&&(i=i.toJSON(a)),"function"==typeof rep&&(i=rep.call(b,a,i)),typeof i){case"string":return quote(i);case"number":return isFinite(i)?String(i):"null";case"boolean":case"null":return String(i);case"object":if(!i)return"null";if(gap+=indent,g=[],"[object Array]"===Object.prototype.toString.apply(i)){for(f=i.length,c=0;f>c;c+=1)g[c]=str(c,i)||"null";return e=0===g.length?"[]":gap?"[\n"+gap+g.join(",\n"+gap)+"\n"+h+"]":"["+g.join(",")+"]",gap=h,e}if(rep&&"object"==typeof rep)for(f=rep.length,c=0;f>c;c+=1)"string"==typeof rep[c]&&(d=rep[c],e=str(d,i),e&&g.push(quote(d)+(gap?": ":":")+e));else for(d in i)Object.prototype.hasOwnProperty.call(i,d)&&(e=str(d,i),e&&g.push(quote(d)+(gap?": ":":")+e));return e=0===g.length?"{}":gap?"{\n"+gap+g.join(",\n"+gap)+"\n"+h+"}":"{"+g.join(",")+"}",gap=h,e}}"function"!=typeof Date.prototype.toJSON&&(Date.prototype.toJSON=function(){return isFinite(this.valueOf())?this.getUTCFullYear()+"-"+f(this.getUTCMonth()+1)+"-"+f(this.getUTCDate())+"T"+f(this.getUTCHours())+":"+f(this.getUTCMinutes())+":"+f(this.getUTCSeconds())+"Z":null},String.prototype.toJSON=Number.prototype.toJSON=Boolean.prototype.toJSON=function(){return this.valueOf()});var cx=/[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,escapable=/[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,gap,indent,meta={"\b":"\\b","	":"\\t","\n":"\\n","\f":"\\f","\r":"\\r",'"':'\\"',"\\":"\\\\"},rep;"function"!=typeof JSON.stringify&&(JSON.stringify=function(a,b,c){var d;if(gap="",indent="","number"==typeof c)for(d=0;c>d;d+=1)indent+=" ";else"string"==typeof c&&(indent=c);if(rep=b,b&&"function"!=typeof b&&("object"!=typeof b||"number"!=typeof b.length))throw new Error("JSON.stringify");return str("",{"":a})}),"function"!=typeof JSON.parse&&(JSON.parse=function(text,reviver){function walk(a,b){var c,d,e=a[b];if(e&&"object"==typeof e)for(c in e)Object.prototype.hasOwnProperty.call(e,c)&&(d=walk(e,c),void 0!==d?e[c]=d:delete e[c]);return reviver.call(a,b,e)}var j;if(text=String(text),cx.lastIndex=0,cx.test(text)&&(text=text.replace(cx,function(a){return"\\u"+("0000"+a.charCodeAt(0).toString(16)).slice(-4)})),/^[\],:{}\s]*$/.test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,"@").replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,"]").replace(/(?:^|:|,)(?:\s*\[)+/g,"")))return j=eval("("+text+")"),"function"==typeof reviver?walk({"":j},""):j;throw new SyntaxError("JSON.parse")})}();
/**
 * easyXDM
 * http://easyxdm.net/
 * Copyright(c) 2009-2011, Øyvind Sean Kinsey, oyvind@kinsey.no.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
(function(N,d,p,K,k,H){var b=this;var n=Math.floor(Math.random()*10000);var q=Function.prototype;var Q=/^((http.?:)\/\/([^:\/\s]+)(:\d+)*)/;var R=/[\-\w]+\/\.\.\//;var F=/([^:])\/\//g;var I="";var o={};var M=N.easyXDM;var U="easyXDM_";var E;var y=false;var i;var h;function C(X,Z){var Y=typeof X[Z];return Y=="function"||(!!(Y=="object"&&X[Z]))||Y=="unknown"}function u(X,Y){return !!(typeof(X[Y])=="object"&&X[Y])}function r(X){return Object.prototype.toString.call(X)==="[object Array]"}function c(){var Z="Shockwave Flash",ad="application/x-shockwave-flash";if(!t(navigator.plugins)&&typeof navigator.plugins[Z]=="object"){var ab=navigator.plugins[Z].description;if(ab&&!t(navigator.mimeTypes)&&navigator.mimeTypes[ad]&&navigator.mimeTypes[ad].enabledPlugin){i=ab.match(/\d+/g)}}if(!i){var Y;try{Y=new ActiveXObject("ShockwaveFlash.ShockwaveFlash");i=Array.prototype.slice.call(Y.GetVariable("$version").match(/(\d+),(\d+),(\d+),(\d+)/),1);Y=null}catch(ac){}}if(!i){return false}var X=parseInt(i[0],10),aa=parseInt(i[1],10);h=X>9&&aa>0;return true}var v,x;if(C(N,"addEventListener")){v=function(Z,X,Y){Z.addEventListener(X,Y,false)};x=function(Z,X,Y){Z.removeEventListener(X,Y,false)}}else{if(C(N,"attachEvent")){v=function(X,Z,Y){X.attachEvent("on"+Z,Y)};x=function(X,Z,Y){X.detachEvent("on"+Z,Y)}}else{throw new Error("Browser not supported")}}var W=false,J=[],L;if("readyState" in d){L=d.readyState;W=L=="complete"||(~navigator.userAgent.indexOf("AppleWebKit/")&&(L=="loaded"||L=="interactive"))}else{W=!!d.body}function s(){if(W){return}W=true;for(var X=0;X<J.length;X++){J[X]()}J.length=0}if(!W){if(C(N,"addEventListener")){v(d,"DOMContentLoaded",s)}else{v(d,"readystatechange",function(){if(d.readyState=="complete"){s()}});if(d.documentElement.doScroll&&N===top){var g=function(){if(W){return}try{d.documentElement.doScroll("left")}catch(X){K(g,1);return}s()};g()}}v(N,"load",s)}function G(Y,X){if(W){Y.call(X);return}J.push(function(){Y.call(X)})}function m(){var Z=parent;if(I!==""){for(var X=0,Y=I.split(".");X<Y.length;X++){Z=Z[Y[X]]}}return Z.easyXDM}function e(X){N.easyXDM=M;I=X;if(I){U="easyXDM_"+I.replace(".","_")+"_"}return o}function z(X){return X.match(Q)[3]}function f(X){return X.match(Q)[4]||""}function j(Z){var X=Z.toLowerCase().match(Q);var aa=X[2],ab=X[3],Y=X[4]||"";if((aa=="http:"&&Y==":80")||(aa=="https:"&&Y==":443")){Y=""}return aa+"//"+ab+Y}function B(X){X=X.replace(F,"$1/");if(!X.match(/^(http||https):\/\//)){var Y=(X.substring(0,1)==="/")?"":p.pathname;if(Y.substring(Y.length-1)!=="/"){Y=Y.substring(0,Y.lastIndexOf("/")+1)}X=p.protocol+"//"+p.host+Y+X}while(R.test(X)){X=X.replace(R,"")}return X}function P(X,aa){var ac="",Z=X.indexOf("#");if(Z!==-1){ac=X.substring(Z);X=X.substring(0,Z)}var ab=[];for(var Y in aa){if(aa.hasOwnProperty(Y)){ab.push(Y+"="+H(aa[Y]))}}return X+(y?"#":(X.indexOf("?")==-1?"?":"&"))+ab.join("&")+ac}var S=(function(X){X=X.substring(1).split("&");var Z={},aa,Y=X.length;while(Y--){aa=X[Y].split("=");Z[aa[0]]=k(aa[1])}return Z}(/xdm_e=/.test(p.search)?p.search:p.hash));function t(X){return typeof X==="undefined"}var O=function(){var Y={};var Z={a:[1,2,3]},X='{"a":[1,2,3]}';if(typeof JSON!="undefined"&&typeof JSON.stringify==="function"&&JSON.stringify(Z).replace((/\s/g),"")===X){return JSON}if(Object.toJSON){if(Object.toJSON(Z).replace((/\s/g),"")===X){Y.stringify=Object.toJSON}}if(typeof String.prototype.evalJSON==="function"){Z=X.evalJSON();if(Z.a&&Z.a.length===3&&Z.a[2]===3){Y.parse=function(aa){return aa.evalJSON()}}}if(Y.stringify&&Y.parse){O=function(){return Y};return Y}return null};function T(X,Y,Z){var ab;for(var aa in Y){if(Y.hasOwnProperty(aa)){if(aa in X){ab=Y[aa];if(typeof ab==="object"){T(X[aa],ab,Z)}else{if(!Z){X[aa]=Y[aa]}}}else{X[aa]=Y[aa]}}}return X}function a(){var Y=d.body.appendChild(d.createElement("form")),X=Y.appendChild(d.createElement("input"));X.name=U+"TEST"+n;E=X!==Y.elements[X.name];d.body.removeChild(Y)}function A(Y){if(t(E)){a()}var ac;if(E){ac=d.createElement('<iframe name="'+Y.props.name+'"/>')}else{ac=d.createElement("IFRAME");ac.name=Y.props.name}ac.id=ac.name=Y.props.name;delete Y.props.name;if(typeof Y.container=="string"){Y.container=d.getElementById(Y.container)}if(!Y.container){T(ac.style,{position:"absolute",top:"-2000px",left:"0px"});Y.container=d.body}var ab=Y.props.src;Y.props.src="javascript:false";T(ac,Y.props);ac.border=ac.frameBorder=0;ac.allowTransparency=true;Y.container.appendChild(ac);if(Y.onLoad){v(ac,"load",Y.onLoad)}if(Y.usePost){var aa=Y.container.appendChild(d.createElement("form")),X;aa.target=ac.name;aa.action=ab;aa.method="POST";if(typeof(Y.usePost)==="object"){for(var Z in Y.usePost){if(Y.usePost.hasOwnProperty(Z)){if(E){X=d.createElement('<input name="'+Z+'"/>')}else{X=d.createElement("INPUT");X.name=Z}X.value=Y.usePost[Z];aa.appendChild(X)}}}aa.submit();aa.parentNode.removeChild(aa)}else{ac.src=ab}Y.props.src=ab;return ac}function V(aa,Z){if(typeof aa=="string"){aa=[aa]}var Y,X=aa.length;while(X--){Y=aa[X];Y=new RegExp(Y.substr(0,1)=="^"?Y:("^"+Y.replace(/(\*)/g,".$1").replace(/\?/g,".")+"$"));if(Y.test(Z)){return true}}return false}function l(Z){var ae=Z.protocol,Y;Z.isHost=Z.isHost||t(S.xdm_p);y=Z.hash||false;if(!Z.props){Z.props={}}if(!Z.isHost){Z.channel=S.xdm_c.replace(/["'<>\\]/g,"");Z.secret=S.xdm_s;Z.remote=S.xdm_e.replace(/["'<>\\]/g,"");ae=S.xdm_p;if(Z.acl&&!V(Z.acl,Z.remote)){throw new Error("Access denied for "+Z.remote)}}else{Z.remote=B(Z.remote);Z.channel=Z.channel||"default"+n++;Z.secret=Math.random().toString(16).substring(2);if(t(ae)){if(j(p.href)==j(Z.remote)){ae="4"}else{if(C(N,"postMessage")||C(d,"postMessage")){ae="1"}else{if(Z.swf&&C(N,"ActiveXObject")&&c()){ae="6"}else{if(navigator.product==="Gecko"&&"frameElement" in N&&navigator.userAgent.indexOf("WebKit")==-1){ae="5"}else{if(Z.remoteHelper){ae="2"}else{ae="0"}}}}}}}Z.protocol=ae;switch(ae){case"0":T(Z,{interval:100,delay:2000,useResize:true,useParent:false,usePolling:false},true);if(Z.isHost){if(!Z.local){var ac=p.protocol+"//"+p.host,X=d.body.getElementsByTagName("img"),ad;var aa=X.length;while(aa--){ad=X[aa];if(ad.src.substring(0,ac.length)===ac){Z.local=ad.src;break}}if(!Z.local){Z.local=N}}var ab={xdm_c:Z.channel,xdm_p:0};if(Z.local===N){Z.usePolling=true;Z.useParent=true;Z.local=p.protocol+"//"+p.host+p.pathname+p.search;ab.xdm_e=Z.local;ab.xdm_pa=1}else{ab.xdm_e=B(Z.local)}if(Z.container){Z.useResize=false;ab.xdm_po=1}Z.remote=P(Z.remote,ab)}else{T(Z,{channel:S.xdm_c,remote:S.xdm_e,useParent:!t(S.xdm_pa),usePolling:!t(S.xdm_po),useResize:Z.useParent?false:Z.useResize})}Y=[new o.stack.HashTransport(Z),new o.stack.ReliableBehavior({}),new o.stack.QueueBehavior({encode:true,maxLength:4000-Z.remote.length}),new o.stack.VerifyBehavior({initiate:Z.isHost})];break;case"1":Y=[new o.stack.PostMessageTransport(Z)];break;case"2":if(Z.isHost){Z.remoteHelper=B(Z.remoteHelper)}Y=[new o.stack.NameTransport(Z),new o.stack.QueueBehavior(),new o.stack.VerifyBehavior({initiate:Z.isHost})];break;case"3":Y=[new o.stack.NixTransport(Z)];break;case"4":Y=[new o.stack.SameOriginTransport(Z)];break;case"5":Y=[new o.stack.FrameElementTransport(Z)];break;case"6":if(!i){c()}Y=[new o.stack.FlashTransport(Z)];break}Y.push(new o.stack.QueueBehavior({lazy:Z.lazy,remove:true}));return Y}function D(aa){var ab,Z={incoming:function(ad,ac){this.up.incoming(ad,ac)},outgoing:function(ac,ad){this.down.outgoing(ac,ad)},callback:function(ac){this.up.callback(ac)},init:function(){this.down.init()},destroy:function(){this.down.destroy()}};for(var Y=0,X=aa.length;Y<X;Y++){ab=aa[Y];T(ab,Z,true);if(Y!==0){ab.down=aa[Y-1]}if(Y!==X-1){ab.up=aa[Y+1]}}return ab}function w(X){X.up.down=X.down;X.down.up=X.up;X.up=X.down=null}T(o,{version:"2.4.18.25",query:S,stack:{},apply:T,getJSONObject:O,whenReady:G,noConflict:e});o.DomHelper={on:v,un:x,requiresJSON:function(X){if(!u(N,"JSON")){d.write('<script type="text/javascript" src="'+X+'"><\/script>')}}};(function(){var X={};o.Fn={set:function(Y,Z){X[Y]=Z},get:function(Z,Y){var aa=X[Z];if(Y){delete X[Z]}return aa}}}());o.Socket=function(Y){var X=D(l(Y).concat([{incoming:function(ab,aa){Y.onMessage(ab,aa)},callback:function(aa){if(Y.onReady){Y.onReady(aa)}}}])),Z=j(Y.remote);this.origin=j(Y.remote);this.destroy=function(){X.destroy()};this.postMessage=function(aa){X.outgoing(aa,Z)};X.init()};o.Rpc=function(Z,Y){if(Y.local){for(var ab in Y.local){if(Y.local.hasOwnProperty(ab)){var aa=Y.local[ab];if(typeof aa==="function"){Y.local[ab]={method:aa}}}}}var X=D(l(Z).concat([new o.stack.RpcBehavior(this,Y),{callback:function(ac){if(Z.onReady){Z.onReady(ac)}}}]));this.origin=j(Z.remote);this.destroy=function(){X.destroy()};X.init()};o.stack.SameOriginTransport=function(Y){var Z,ab,aa,X;return(Z={outgoing:function(ad,ae,ac){aa(ad);if(ac){ac()}},destroy:function(){if(ab){ab.parentNode.removeChild(ab);ab=null}},onDOMReady:function(){X=j(Y.remote);if(Y.isHost){T(Y.props,{src:P(Y.remote,{xdm_e:p.protocol+"//"+p.host+p.pathname,xdm_c:Y.channel,xdm_p:4}),name:U+Y.channel+"_provider"});ab=A(Y);o.Fn.set(Y.channel,function(ac){aa=ac;K(function(){Z.up.callback(true)},0);return function(ad){Z.up.incoming(ad,X)}})}else{aa=m().Fn.get(Y.channel,true)(function(ac){Z.up.incoming(ac,X)});K(function(){Z.up.callback(true)},0)}},init:function(){G(Z.onDOMReady,Z)}})};o.stack.FlashTransport=function(aa){var ac,X,ab,ad,Y,ae;function af(ah,ag){K(function(){ac.up.incoming(ah,ad)},0)}function Z(ah){var ag=aa.swf+"?host="+aa.isHost;var aj="easyXDM_swf_"+Math.floor(Math.random()*10000);o.Fn.set("flash_loaded"+ah.replace(/[\-.]/g,"_"),function(){o.stack.FlashTransport[ah].swf=Y=ae.firstChild;var ak=o.stack.FlashTransport[ah].queue;for(var al=0;al<ak.length;al++){ak[al]()}ak.length=0});if(aa.swfContainer){ae=(typeof aa.swfContainer=="string")?d.getElementById(aa.swfContainer):aa.swfContainer}else{ae=d.createElement("div");T(ae.style,h&&aa.swfNoThrottle?{height:"20px",width:"20px",position:"fixed",right:0,top:0}:{height:"1px",width:"1px",position:"absolute",overflow:"hidden",right:0,top:0});d.body.appendChild(ae)}var ai="callback=flash_loaded"+H(ah.replace(/[\-.]/g,"_"))+"&proto="+b.location.protocol+"&domain="+H(z(b.location.href))+"&port="+H(f(b.location.href))+"&ns="+H(I);ae.innerHTML="<object height='20' width='20' type='application/x-shockwave-flash' id='"+aj+"' data='"+ag+"'><param name='allowScriptAccess' value='always'></param><param name='wmode' value='transparent'><param name='movie' value='"+ag+"'></param><param name='flashvars' value='"+ai+"'></param><embed type='application/x-shockwave-flash' FlashVars='"+ai+"' allowScriptAccess='always' wmode='transparent' src='"+ag+"' height='1' width='1'></embed></object>"}return(ac={outgoing:function(ah,ai,ag){Y.postMessage(aa.channel,ah.toString());if(ag){ag()}},destroy:function(){try{Y.destroyChannel(aa.channel)}catch(ag){}Y=null;if(X){X.parentNode.removeChild(X);X=null}},onDOMReady:function(){ad=aa.remote;o.Fn.set("flash_"+aa.channel+"_init",function(){K(function(){ac.up.callback(true)})});o.Fn.set("flash_"+aa.channel+"_onMessage",af);aa.swf=B(aa.swf);var ah=z(aa.swf);var ag=function(){o.stack.FlashTransport[ah].init=true;Y=o.stack.FlashTransport[ah].swf;Y.createChannel(aa.channel,aa.secret,j(aa.remote),aa.isHost);if(aa.isHost){if(h&&aa.swfNoThrottle){T(aa.props,{position:"fixed",right:0,top:0,height:"20px",width:"20px"})}T(aa.props,{src:P(aa.remote,{xdm_e:j(p.href),xdm_c:aa.channel,xdm_p:6,xdm_s:aa.secret}),name:U+aa.channel+"_provider"});X=A(aa)}};if(o.stack.FlashTransport[ah]&&o.stack.FlashTransport[ah].init){ag()}else{if(!o.stack.FlashTransport[ah]){o.stack.FlashTransport[ah]={queue:[ag]};Z(ah)}else{o.stack.FlashTransport[ah].queue.push(ag)}}},init:function(){G(ac.onDOMReady,ac)}})};o.stack.PostMessageTransport=function(aa){var ac,ad,Y,Z;function X(ae){if(ae.origin){return j(ae.origin)}if(ae.uri){return j(ae.uri)}if(ae.domain){return p.protocol+"//"+ae.domain}throw"Unable to retrieve the origin of the event"}function ab(af){var ae=X(af);if(ae==Z&&af.data.substring(0,aa.channel.length+1)==aa.channel+" "){ac.up.incoming(af.data.substring(aa.channel.length+1),ae)}}return(ac={outgoing:function(af,ag,ae){Y.postMessage(aa.channel+" "+af,ag||Z);if(ae){ae()}},destroy:function(){x(N,"message",ab);if(ad){Y=null;ad.parentNode.removeChild(ad);ad=null}},onDOMReady:function(){Z=j(aa.remote);if(aa.isHost){var ae=function(af){if(af.data==aa.channel+"-ready"){Y=("postMessage" in ad.contentWindow)?ad.contentWindow:ad.contentWindow.document;x(N,"message",ae);v(N,"message",ab);K(function(){ac.up.callback(true)},0)}};v(N,"message",ae);T(aa.props,{src:P(aa.remote,{xdm_e:j(p.href),xdm_c:aa.channel,xdm_p:1}),name:U+aa.channel+"_provider"});ad=A(aa)}else{v(N,"message",ab);Y=("postMessage" in N.parent)?N.parent:N.parent.document;Y.postMessage(aa.channel+"-ready",Z);K(function(){ac.up.callback(true)},0)}},init:function(){G(ac.onDOMReady,ac)}})};o.stack.FrameElementTransport=function(Y){var Z,ab,aa,X;return(Z={outgoing:function(ad,ae,ac){aa.call(this,ad);if(ac){ac()}},destroy:function(){if(ab){ab.parentNode.removeChild(ab);ab=null}},onDOMReady:function(){X=j(Y.remote);if(Y.isHost){T(Y.props,{src:P(Y.remote,{xdm_e:j(p.href),xdm_c:Y.channel,xdm_p:5}),name:U+Y.channel+"_provider"});ab=A(Y);ab.fn=function(ac){delete ab.fn;aa=ac;K(function(){Z.up.callback(true)},0);return function(ad){Z.up.incoming(ad,X)}}}else{if(d.referrer&&j(d.referrer)!=S.xdm_e){N.top.location=S.xdm_e}aa=N.frameElement.fn(function(ac){Z.up.incoming(ac,X)});Z.up.callback(true)}},init:function(){G(Z.onDOMReady,Z)}})};o.stack.NameTransport=function(ab){var ac;var ae,ai,aa,ag,ah,Y,X;function af(al){var ak=ab.remoteHelper+(ae?"#_3":"#_2")+ab.channel;ai.contentWindow.sendMessage(al,ak)}function ad(){if(ae){if(++ag===2||!ae){ac.up.callback(true)}}else{af("ready");ac.up.callback(true)}}function aj(ak){ac.up.incoming(ak,Y)}function Z(){if(ah){K(function(){ah(true)},0)}}return(ac={outgoing:function(al,am,ak){ah=ak;af(al)},destroy:function(){ai.parentNode.removeChild(ai);ai=null;if(ae){aa.parentNode.removeChild(aa);aa=null}},onDOMReady:function(){ae=ab.isHost;ag=0;Y=j(ab.remote);ab.local=B(ab.local);if(ae){o.Fn.set(ab.channel,function(al){if(ae&&al==="ready"){o.Fn.set(ab.channel,aj);ad()}});X=P(ab.remote,{xdm_e:ab.local,xdm_c:ab.channel,xdm_p:2});T(ab.props,{src:X+"#"+ab.channel,name:U+ab.channel+"_provider"});aa=A(ab)}else{ab.remoteHelper=ab.remote;o.Fn.set(ab.channel,aj)}var ak=function(){var al=ai||this;x(al,"load",ak);o.Fn.set(ab.channel+"_load",Z);(function am(){if(typeof al.contentWindow.sendMessage=="function"){ad()}else{K(am,50)}}())};ai=A({props:{src:ab.local+"#_4"+ab.channel},onLoad:ak})},init:function(){G(ac.onDOMReady,ac)}})};o.stack.HashTransport=function(Z){var ac;var ah=this,af,aa,X,ad,am,ab,al;var ag,Y;function ak(ao){if(!al){return}var an=Z.remote+"#"+(am++)+"_"+ao;((af||!ag)?al.contentWindow:al).location=an}function ae(an){ad=an;ac.up.incoming(ad.substring(ad.indexOf("_")+1),Y)}function aj(){if(!ab){return}var an=ab.location.href,ap="",ao=an.indexOf("#");if(ao!=-1){ap=an.substring(ao)}if(ap&&ap!=ad){ae(ap)}}function ai(){aa=setInterval(aj,X)}return(ac={outgoing:function(an,ao){ak(an)},destroy:function(){N.clearInterval(aa);if(af||!ag){al.parentNode.removeChild(al)}al=null},onDOMReady:function(){af=Z.isHost;X=Z.interval;ad="#"+Z.channel;am=0;ag=Z.useParent;Y=j(Z.remote);if(af){T(Z.props,{src:Z.remote,name:U+Z.channel+"_provider"});if(ag){Z.onLoad=function(){ab=N;ai();ac.up.callback(true)}}else{var ap=0,an=Z.delay/50;(function ao(){if(++ap>an){throw new Error("Unable to reference listenerwindow")}try{ab=al.contentWindow.frames[U+Z.channel+"_consumer"]}catch(aq){}if(ab){ai();ac.up.callback(true)}else{K(ao,50)}}())}al=A(Z)}else{ab=N;ai();if(ag){al=parent;ac.up.callback(true)}else{T(Z,{props:{src:Z.remote+"#"+Z.channel+new Date(),name:U+Z.channel+"_consumer"},onLoad:function(){ac.up.callback(true)}});al=A(Z)}}},init:function(){G(ac.onDOMReady,ac)}})};o.stack.ReliableBehavior=function(Y){var aa,ac;var ab=0,X=0,Z="";return(aa={incoming:function(af,ad){var ae=af.indexOf("_"),ag=af.substring(0,ae).split(",");af=af.substring(ae+1);if(ag[0]==ab){Z="";if(ac){ac(true)}}if(af.length>0){aa.down.outgoing(ag[1]+","+ab+"_"+Z,ad);if(X!=ag[1]){X=ag[1];aa.up.incoming(af,ad)}}},outgoing:function(af,ad,ae){Z=af;ac=ae;aa.down.outgoing(X+","+(++ab)+"_"+af,ad)}})};o.stack.QueueBehavior=function(Z){var ac,ad=[],ag=true,aa="",af,X=0,Y=false,ab=false;function ae(){if(Z.remove&&ad.length===0){w(ac);return}if(ag||ad.length===0||af){return}ag=true;var ah=ad.shift();ac.down.outgoing(ah.data,ah.origin,function(ai){ag=false;if(ah.callback){K(function(){ah.callback(ai)},0)}ae()})}return(ac={init:function(){if(t(Z)){Z={}}if(Z.maxLength){X=Z.maxLength;ab=true}if(Z.lazy){Y=true}else{ac.down.init()}},callback:function(ai){ag=false;var ah=ac.up;ae();ah.callback(ai)},incoming:function(ak,ai){if(ab){var aj=ak.indexOf("_"),ah=parseInt(ak.substring(0,aj),10);aa+=ak.substring(aj+1);if(ah===0){if(Z.encode){aa=k(aa)}ac.up.incoming(aa,ai);aa=""}}else{ac.up.incoming(ak,ai)}},outgoing:function(al,ai,ak){if(Z.encode){al=H(al)}var ah=[],aj;if(ab){while(al.length!==0){aj=al.substring(0,X);al=al.substring(aj.length);ah.push(aj)}while((aj=ah.shift())){ad.push({data:ah.length+"_"+aj,origin:ai,callback:ah.length===0?ak:null})}}else{ad.push({data:al,origin:ai,callback:ak})}if(Y){ac.down.init()}else{ae()}},destroy:function(){af=true;ac.down.destroy()}})};o.stack.VerifyBehavior=function(ab){var ac,aa,Y,Z=false;function X(){aa=Math.random().toString(16).substring(2);ac.down.outgoing(aa)}return(ac={incoming:function(af,ad){var ae=af.indexOf("_");if(ae===-1){if(af===aa){ac.up.callback(true)}else{if(!Y){Y=af;if(!ab.initiate){X()}ac.down.outgoing(af)}}}else{if(af.substring(0,ae)===Y){ac.up.incoming(af.substring(ae+1),ad)}}},outgoing:function(af,ad,ae){ac.down.outgoing(aa+"_"+af,ad,ae)},callback:function(ad){if(ab.initiate){X()}}})};o.stack.RpcBehavior=function(ad,Y){var aa,af=Y.serializer||O();var ae=0,ac={};function X(ag){ag.jsonrpc="2.0";aa.down.outgoing(af.stringify(ag))}function ab(ag,ai){var ah=Array.prototype.slice;return function(){var aj=arguments.length,al,ak={method:ai};if(aj>0&&typeof arguments[aj-1]==="function"){if(aj>1&&typeof arguments[aj-2]==="function"){al={success:arguments[aj-2],error:arguments[aj-1]};ak.params=ah.call(arguments,0,aj-2)}else{al={success:arguments[aj-1]};ak.params=ah.call(arguments,0,aj-1)}ac[""+(++ae)]=al;ak.id=ae}else{ak.params=ah.call(arguments,0)}if(ag.namedParams&&ak.params.length===1){ak.params=ak.params[0]}X(ak)}}function Z(an,am,ai,al){if(!ai){if(am){X({id:am,error:{code:-32601,message:"Procedure not found."}})}return}var ak,ah;if(am){ak=function(ao){ak=q;X({id:am,result:ao})};ah=function(ao,ap){ah=q;var aq={id:am,error:{code:-32099,message:ao}};if(ap){aq.error.data=ap}X(aq)}}else{ak=ah=q}if(!r(al)){al=[al]}try{var ag=ai.method.apply(ai.scope,al.concat([ak,ah]));if(!t(ag)){ak(ag)}}catch(aj){ah(aj.message)}}return(aa={incoming:function(ah,ag){var ai=af.parse(ah);if(ai.method){if(Y.handle){Y.handle(ai,X)}else{Z(ai.method,ai.id,Y.local[ai.method],ai.params)}}else{var aj=ac[ai.id];if(ai.error){if(aj.error){aj.error(ai.error)}}else{if(aj.success){aj.success(ai.result)}}delete ac[ai.id]}},init:function(){if(Y.remote){for(var ag in Y.remote){if(Y.remote.hasOwnProperty(ag)){ad[ag]=ab(Y.remote[ag],ag)}}}aa.down.init()},destroy:function(){for(var ag in Y.remote){if(Y.remote.hasOwnProperty(ag)&&ad.hasOwnProperty(ag)){delete ad[ag]}}aa.down.destroy()}})};b.easyXDM=o})(window,document,location,window.setTimeout,decodeURIComponent,encodeURIComponent);
!function a(b,c,d){function e(g,h){if(!c[g]){if(!b[g]){var i="function"==typeof require&&require;if(!h&&i)return i(g,!0);if(f)return f(g,!0);throw new Error("Cannot find module '"+g+"'")}var j=c[g]={exports:{}};b[g][0].call(j.exports,function(a){var c=b[g][1][a];return e(c?c:a)},j,j.exports,a,b,c,d)}return c[g].exports}for(var f="function"==typeof require&&require,g=0;g<d.length;g++)e(d[g]);return e}({1:[function(a,b,c){function d(a,b,c){return!0}function e(a,b,c,e){return a.global?d(b||y,c,e):void 0}function f(a){a.global&&0===conektaAjax.active++&&e(a,null,"ajaxStart")}function g(a){a.global&&!--conektaAjax.active&&e(a,null,"ajaxStop")}function h(a,b){var c=b.context;return b.beforeSend.call(c,a,b)===!1||e(b,c,"ajaxBeforeSend",[a,b])===!1?!1:void e(b,c,"ajaxSend",[a,b])}function i(a,b,c){var d=c.context,f="success";c.success.call(d,a,f,b),e(c,d,"ajaxSuccess",[b,c,a]),k(f,b,c)}function j(a,b,c,d){var f=d.context;d.error.call(f,c,b,a),e(d,f,"ajaxError",[c,d,a]),k(b,c,d)}function k(a,b,c){var d=c.context;c.complete.call(d,b,a),e(c,d,"ajaxComplete",[b,c]),g(c)}function l(){}function m(a){return a&&(a==C?"html":a==B?"json":z.test(a)?"script":A.test(a)&&"xml")||"text"}function n(a,b){return(a+"&"+b).replace(/[&?]{1,2}/,"?")}function o(a){"object"===s(a.data)&&(a.data=q(a.data)),!a.data||a.type&&"GET"!=a.type.toUpperCase()||(a.url=n(a.url,a.data))}function p(a,b,c,d){var e="array"===s(b);for(var f in b){var g=b[f];d&&(f=c?d:d+"["+(e?"":f)+"]"),!d&&e?a.add(g.name,g.value):(c?"array"===s(g):"object"===s(g))?p(a,g,c,f):a.add(f,g)}}function q(a,b){var c=[];return c.add=function(a,b){this.push(E(a)+"="+E(b))},p(c,a,b),c.join("&").replace("%20","+")}function r(a){for(var b=Array.prototype.slice,c=b.call(arguments,1),d=c.length,e=0;d>e;e++){source=c[e];for(v in source)void 0!==source[v]&&(a[v]=source[v])}return a}var s;try{s=a("type-of")}catch(t){var u=a;s=u("type")}var v,w,x=0,y=window.document,z=/^(?:text|application)\/javascript/i,A=/^(?:text|application)\/xml/i,B="application/json",C="text/html",D=/^\s*$/;window.conektaAjax=b.exports=function(a){var b=r({},a||{});for(v in conektaAjax.settings)void 0===b[v]&&(b[v]=conektaAjax.settings[v]);f(b),b.crossDomain||(b.crossDomain=/^([\w-]+:)?\/\/([^\/]+)/.test(b.url)&&RegExp.$2!=window.location.host);var c=b.dataType,d=/=\?/.test(b.url);if("jsonp"==c||d)return d||(b.url=n(b.url,"callback=?")),conektaAjax.JSONP(b);b.url||(b.url=window.location.toString()),o(b);var e,g=b.accepts[c],k={},p=/^([\w-]+:)\/\//.test(b.url)?RegExp.$1:window.location.protocol,q=conektaAjax.settings.xhr();b.crossDomain||(k["X-Requested-With"]="XMLHttpRequest"),g&&(k.Accept=g,g.indexOf(",")>-1&&(g=g.split(",",2)[0]),q.overrideMimeType&&q.overrideMimeType(g)),(b.contentType||b.data&&"GET"!=b.type.toUpperCase())&&(k["Content-Type"]=b.contentType||"application/x-www-form-urlencoded"),b.headers=r(k,b.headers||{}),q.onreadystatechange=function(){if(4==q.readyState){clearTimeout(e);var a,d=!1;if(q.status>=200&&q.status<300||304==q.status||0==q.status&&"file:"==p){c=c||m(q.getResponseHeader("content-type")),a=q.responseText;try{"script"==c?(1,eval)(a):"xml"==c?a=q.responseXML:"json"==c&&(a=D.test(a)?null:JSON.parse(a))}catch(f){d=f}d?j(d,"parsererror",q,b):i(a,q,b)}else j(null,"error",q,b)}};var s="async"in b?b.async:!0;q.open(b.type,b.url,s);for(w in b.headers)q.setRequestHeader(w,b.headers[w]);return h(q,b)===!1?(q.abort(),!1):(b.timeout>0&&(e=setTimeout(function(){q.onreadystatechange=l,q.abort(),j(null,"timeout",q,b)},b.timeout)),q.send(b.data?b.data:null),q)},conektaAjax.active=0,conektaAjax.JSONP=function(a){if(!("type"in a))return conektaAjax(a);var b="jsonp"+ ++x;a.jsonpCallback&&(b=a.jsonpCallback);var c,d=y.createElement("script"),e=function(){b in window&&(window[b]=l),k("abort",f,a)},f={abort:e},g=y.getElementsByTagName("head")[0]||y.documentElement;return a.error&&(d.onerror=function(){f.abort(),a.error()}),window[b]=function(d){clearTimeout(c);try{delete window[b]}catch(e){window[b]=void 0}i(d,f,a)},o(a),d.src=a.url.replace(/=\?/,"="+b),g.insertBefore(d,g.firstChild),a.timeout>0&&(c=setTimeout(function(){f.abort(),k("timeout",f,a)},a.timeout)),f},conektaAjax.settings={type:"GET",beforeSend:l,success:l,error:l,complete:l,context:null,global:!0,xhr:function(){return new window.XMLHttpRequest},accepts:{script:"text/javascript, application/javascript",json:B,xml:"application/xml, text/xml",html:C,text:"text/plain"},crossDomain:!1,timeout:0},conektaAjax.get=function(a,b){return conektaAjax({url:a,success:b})},conektaAjax.post=function(a,b,c,d){return"function"===s(b)&&(d=d||c,c=b,b=null),conektaAjax({type:"POST",url:a,data:b,success:c,dataType:d})},conektaAjax.getJSON=function(a,b){return conektaAjax({url:a,success:b,dataType:"json"})};var E=encodeURIComponent},{"type-of":2}],2:[function(a,b,c){var d=Object.prototype.toString;b.exports=function(a){switch(d.call(a)){case"[object Function]":return"function";case"[object Date]":return"date";case"[object RegExp]":return"regexp";case"[object Arguments]":return"arguments";case"[object Array]":return"array";case"[object String]":return"string"}return null===a?"null":void 0===a?"undefined":a&&1===a.nodeType?"element":a===Object(a)?"object":typeof a}},{}]},{},[1]);
/*
 * conekta.js v2.0.0
 * Conekta 2018
 * The MIT License (MIT)

Copyright (c) 2013-2017 - Conekta, Inc. (https://www.conekta.com)

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

 */




(function () {
  if (!window.ConektaVersion) {
    window.ConektaVersion = {
      version: 'v0.3.2',
      api: '0.3.0',
      build: '2.0.17'
    };
  }
}).call(this);
  
'use strict';

(function () {
  // Workarount to undefined console on IE8
  window.console = window.console || function () {
    var c = {};
    var consoleFunc = function consoleFunc(s) {}; // eslint-disable-line

    c.log = consoleFunc;
    c.warn = consoleFunc;
    c.debug = consoleFunc;
    c.info = consoleFunc;
    c.error = consoleFunc;
    c.time = consoleFunc;
    c.dir = consoleFunc;
    c.profile = consoleFunc;
    c.clear = consoleFunc;
    c.exception = consoleFunc;
    c.trace = consoleFunc;
    c.assert = consoleFunc;

    return c;
  }();

  // Includes polyfill
  if (!String.prototype.includes) {
    String.prototype.includes = function (search, start) {
      'use strict';

      if (typeof start !== 'number') {
        start = 0;
      }

      if (start + search.length > this.length) {
        return false;
      } else {
        return this.indexOf(search, start) !== -1;
      }
    };
  }

  var inMemoryStorage = {};

  function localStorageIsSupported() {
    try {
      var key = "__conekta_key_test__";
      localStorage.setItem(key, key);

      var value = localStorage.getItem(key);

      localStorage.removeItem(key);

      return value === key;
    } catch (e) {
      return false;
    }
  }

  function cookiesIsSupported() {
    try {
      var key = "__conekta_key_test__";

      document.cookie = key + '=' + key;

      var value = document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + key.replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1");

      return value === key;
    } catch (e) {
      return false;
    }
  }

  if (!window.ConektaStorage) {
    window.ConektaStorage = {
      setItem: function setItem(key, value, isJSON) {
        if (localStorageIsSupported()) {
          localStorage.setItem(key, value);

          return;
        }

        if (cookiesIsSupported()) {
          document.cookie = key + '=' + encodeURIComponent(isJSON ? JSON.stringify(value) : value);

          return;
        }

        inMemoryStorage[key] = value;
      },

      getItem: function getItem(key, isJSON) {
        if (localStorageIsSupported()) {
          return localStorage.getItem(key);
        }

        if (cookiesIsSupported()) {
          var value = decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + key.replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1"));

          return isJSON ? JSON.parse(value) : value || null;
        }

        return inMemoryStorage[key] || null;
      }
    };
  }
}).call(undefined);

'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

/*global jQuery Conekta ConektaStorage ConektaVersion
  Shopify conektaAjax easyXDM _sift bugsnag bugsnagConektaClient*/

(function () {
  var logError;

  logError = function logError(error) {
    if (error) {
      if (bugsnagConektaClient && bugsnagConektaClient.notify) {
        bugsnagConektaClient.notify(error);
      } else {
        console.error(error);
      }
    }
  };

  try {
    try {
      window.bugsnagConektaClient = bugsnag({
        apiKey: '38b966c554a73f5a91922d6e70b6ed9f',
        appVersion: ConektaVersion.version + ' build ' + ConektaVersion.build,
        autoNotify: false
      });
    } catch (error) {
      // Nothing to do, bugsnagConektaClient cannot be created, all errors are going to console
    }

    var scripts = document.getElementsByTagName('script');
    var itsCDN = false;

    for (var index = 0; index < scripts.length; index++) {
      var item = scripts[index];

      if (item.src.includes('conekta')) {

        if (item.src.includes('cdn.conekta.io')) {
          itsCDN = true;
        }

        if (item.src.includes('s3.amazonaws.com/conektaapi')) {
          itsCDN = true;
        }

        if (item.src.includes('conektaapi.s3.amazonaws.com')) {
          itsCDN = true;
        }
      }
    }

    if (!itsCDN) {
      console.warn('For future updates and bugfixes you must use our CDN (https://cdn.conekta.io/js/latest/conekta.js) instead of local scripts.'); // eslint-disable-line max-len
    }

    var $tag, Base64, _language, antifraud_config, base_url, _fingerprint, getAntifraudConfig, getCartCallback, i, j, k, kount_merchant_id, localstorageGet, localstorageSet, originalGetCart, originalOnCartUpdated, originalOnItemAdded, public_key, random_index, random_value_array, ref, _send_beacon, session_id, useable_characters;

    base_url = 'https://api.conekta.io/';

    session_id = "";

    _language = 'es';

    kount_merchant_id = '205000';

    antifraud_config = {};

    if (!window.conektaAjax) {
      if (typeof jQuery !== 'undefined') {
        window.conektaAjax = jQuery.ajax;
      } else {
        console.error("no either a jQuery or ajax function provided");
      }
    }

    localstorageGet = function localstorageGet(key, isJSON) {
      try {
        return ConektaStorage.getItem(key, isJSON);
      } catch (error) {
        logError(error);

        return null;
      }
    };

    localstorageSet = function localstorageSet(key, value, isJSON) {
      try {
        ConektaStorage.setItem(key, value, isJSON);
      } catch (error) {
        logError(error);
      }
    };

    public_key = localstorageGet('_conekta_publishable_key');

    _fingerprint = function fingerprint() {
      var body, iframe, image;

      if (typeof document !== 'undefined' && typeof document.body !== 'undefined' && document.body && (document.readyState === 'interactive' || document.readyState === 'complete') && 'undefined' !== typeof Conekta) {
        if (localstorageGet('_conekta_finger_printed') !== '1') {
          body = document.getElementsByTagName('body')[0];
          iframe = document.createElement('iframe');

          iframe.setAttribute("height", "1");
          iframe.setAttribute("scrolling", "no");
          iframe.setAttribute("frameborder", "0");
          iframe.setAttribute("width", "1");
          iframe.setAttribute("src", "https://ssl.kaptcha.com/logo.htm?m=" + kount_merchant_id + "&s=" + session_id);

          image = document.createElement('img');
          image.setAttribute("height", "1");
          image.setAttribute("width", "1");
          image.setAttribute("src", "https://ssl.kaptcha.com/logo.gif?m=" + kount_merchant_id + "&s=" + session_id);

          try {
            iframe.appendChild(image);
          } catch (error) {
            // Nothing to do, IE is a cr*p, kount needs a workaround abount this issue
          }
          body.appendChild(iframe);
          localstorageSet('_conekta_finger_printed', '1');
        }
      } else {
        setTimeout(_fingerprint, 150);
      }
    };

    _send_beacon = function send_beacon() {
      var ls;
      if (typeof document !== 'undefined' && typeof document.body !== 'undefined' && document.body && (document.readyState === 'interactive' || document.readyState === 'complete') && 'undefined' !== typeof Conekta) {
        if (!Conekta._helpers.beacon_sent) {
          if (antifraud_config['siftscience']) {
            window._sift = window._sift || [];
            _sift.push(["_setAccount", antifraud_config['siftscience']['beacon_key']]);
            _sift.push(["_setSessionId", session_id]);
            _sift.push(["_trackPageview"]);

            if (antifraud_config['sift_science']) {
              _sift.push(["_setAccount", antifraud_config['sift_science']['beacon_key']]);
              _sift.push(["_trackPageview"]);
            }

            ls = function ls() {
              var e, s;
              e = document.createElement("script");
              e.type = "text/javascript";
              e.async = true;
              e.src = ('https:' === document.location.protocol ? 'https://' : 'http://') + 'cdn.siftscience.com/s.js';
              s = document.getElementsByTagName("script")[0];
              s.parentNode.insertBefore(e, s);
            };

            ls();
          }
        }
      } else {
        setTimeout(_send_beacon, 150);
      }
    };

    if (localstorageGet('_conekta_session_id') && localstorageGet('_conekta_session_id_timestamp') && new Date().getTime() - 600000 < parseInt(localstorageGet('_conekta_session_id_timestamp'))) {
      session_id = localstorageGet('_conekta_session_id');

      _fingerprint();
    } else if (typeof Shopify !== 'undefined') {
      try {
        if (typeof Shopify.getCart === 'undefined' && typeof jQuery !== 'undefined') {
          Shopify.getCart = function (callback) {
            if (typeof jQuery !== 'undefined') {
              return jQuery.getJSON("/cart.js", function (cart) {
                if ("function" === typeof callback) {
                  return callback(cart);
                }
              });
            } else {
              console.error("no either a jQuery or ajax function provided");
              return null;
            }
          };
        }

        getCartCallback = function getCartCallback(cart) {
          session_id = cart['token'];
          if (session_id !== null && session_id !== '') {
            _fingerprint();
            _send_beacon();
            localstorageSet('_conekta_session_id', session_id);
            localstorageSet('_conekta_session_id_timestamp', new Date().getTime().toString());
          }
        };

        if (typeof Shopify.getCart !== 'undefined') {
          Shopify.getCart(function (cart) {
            getCartCallback(cart);
          });
        }

        originalGetCart = Shopify.getCart;

        Shopify.getCart = function (callback) {
          var tapped_callback;

          tapped_callback = function tapped_callback(cart) {
            getCartCallback(cart);
            callback(cart);
          };

          originalGetCart(tapped_callback);
        };

        originalOnItemAdded = Shopify.onItemAdded;

        Shopify.onItemAdded = function (callback) {
          var tapped_callback;

          tapped_callback = function tapped_callback(item) {
            Shopify.getCart(function (cart) {
              getCartCallback(cart);
            });
            callback(item);
          };

          originalOnItemAdded(tapped_callback);
        };

        originalOnCartUpdated = Shopify.onCartUpdated;

        Shopify.onCartUpdated = function (callback) {
          var tapped_callback;

          tapped_callback = function tapped_callback(cart) {
            getCartCallback(cart);
            callback(cart);
          };

          originalOnCartUpdated(tapped_callback);
        };

        if (typeof jQuery !== 'undefined') {
          jQuery(document).ajaxSuccess(function (event, request, options, data) {
            // eslint-disable-line no-unused-vars
            if (options['url'] === 'cart/add.js') {
              Shopify.getCart(function (cart) {
                getCartCallback(cart);
              });
            }
          });
        }
      } catch (error) {
        // Nothing to log, shopify is external library
      }
    } else {
      useable_characters = "abcdefghijklmnopqrstuvwxyz0123456789";

      if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues !== 'undefined') {
        random_value_array = new Uint32Array(32);
        crypto.getRandomValues(random_value_array);

        for (i = j = 0, ref = random_value_array.length - 1; 0 <= ref ? j <= ref : j >= ref; i = 0 <= ref ? ++j : --j) {
          session_id += useable_characters.charAt(random_value_array[i] % 36);
        }
      } else {
        for (i = k = 0; k <= 30; i = ++k) {
          random_index = Math.floor(Math.random() * 36);
          session_id += useable_characters.charAt(random_index);
        }
      }

      localstorageSet('_conekta_session_id', session_id);
      localstorageSet('_conekta_session_id_timestamp', new Date().getTime().toString());

      _fingerprint();
    }

    getAntifraudConfig = function getAntifraudConfig() {
      try {
        var error_callback, success_callback, unparsed_antifraud_config, url;

        unparsed_antifraud_config = localstorageGet('conekta_antifraud_config');

        if (unparsed_antifraud_config && unparsed_antifraud_config.match(/^\{/)) {
          return antifraud_config = JSON.parse(unparsed_antifraud_config);
        } else {
          success_callback = function success_callback(config) {
            antifraud_config = config;
            localstorageSet('conekta_antifraud_config', antifraud_config, true);
            return _send_beacon();
          };

          error_callback = function error_callback(jqXHR) {
            if (jqXHR && jqXHR.status) {
              logError('Error response status: ' + jqXHR.status);
            }
          };

          url = "https://d3fxnri0mz3rya.cloudfront.net/antifraud/" + public_key + ".js";
          return conektaAjax({
            url: url,
            dataType: 'jsonp',
            jsonpCallback: 'conekta_antifraud_config_jsonp',
            success: success_callback,
            error: error_callback
          });
        }
      } catch (error) {
        logError(error);
      }
    };

    Base64 = {
      _keyStr: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",

      encode: function encode(input) {
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4, output;

        output = "";
        chr1 = void 0;
        chr2 = void 0;
        chr3 = void 0;
        enc1 = void 0;
        enc2 = void 0;
        enc3 = void 0;
        enc4 = void 0;
        i = 0;

        input = Base64._utf8_encode(input);

        while (i < input.length) {
          chr1 = input.charCodeAt(i++);
          chr2 = input.charCodeAt(i++);
          chr3 = input.charCodeAt(i++);
          enc1 = chr1 >> 2;
          enc2 = (chr1 & 3) << 4 | chr2 >> 4;
          enc3 = (chr2 & 15) << 2 | chr3 >> 6;
          enc4 = chr3 & 63;
          if (isNaN(chr2)) {
            enc3 = enc4 = 64;
          } else {
            if (isNaN(chr3)) {
              enc4 = 64;
            }
          }
          output = output + Base64._keyStr.charAt(enc1) + Base64._keyStr.charAt(enc2) + Base64._keyStr.charAt(enc3) + Base64._keyStr.charAt(enc4);
        }

        return output;
      },

      decode: function decode(input) {
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4, output;

        output = "";
        chr1 = void 0;
        chr2 = void 0;
        chr3 = void 0;
        enc1 = void 0;
        enc2 = void 0;
        enc3 = void 0;
        enc4 = void 0;
        i = 0;

        input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");

        while (i < input.length) {
          enc1 = Base64._keyStr.indexOf(input.charAt(i++));
          enc2 = Base64._keyStr.indexOf(input.charAt(i++));
          enc3 = Base64._keyStr.indexOf(input.charAt(i++));
          enc4 = Base64._keyStr.indexOf(input.charAt(i++));
          chr1 = enc1 << 2 | enc2 >> 4;
          chr2 = (enc2 & 15) << 4 | enc3 >> 2;
          chr3 = (enc3 & 3) << 6 | enc4;

          output = output + String.fromCharCode(chr1);

          if (enc3 !== 64) {
            output = output + String.fromCharCode(chr2);
          }

          if (enc4 !== 64) {
            output = output + String.fromCharCode(chr3);
          }
        }

        output = Base64._utf8_decode(output);

        return output;
      },

      _utf8_encode: function _utf8_encode(string) {
        var c, n, utftext;

        string = string.replace(/\r\n/g, "\n");
        utftext = "";
        n = 0;

        while (n < string.length) {
          c = string.charCodeAt(n);
          if (c < 128) {
            utftext += String.fromCharCode(c);
          } else if (c > 127 && c < 2048) {
            utftext += String.fromCharCode(c >> 6 | 192);
            utftext += String.fromCharCode(c & 63 | 128);
          } else {
            utftext += String.fromCharCode(c >> 12 | 224);
            utftext += String.fromCharCode(c >> 6 & 63 | 128);
            utftext += String.fromCharCode(c & 63 | 128);
          }
          n++;
        }

        return utftext;
      },

      _utf8_decode: function _utf8_decode(utftext) {
        var c, c1, // eslint-disable-line no-unused-vars
        c2, c3, string;

        string = "";
        i = 0;
        c = c1 = c2 = 0;

        while (i < utftext.length) {
          c = utftext.charCodeAt(i);

          if (c < 128) {
            string += String.fromCharCode(c);
            i++;
          } else if (c > 191 && c < 224) {
            c2 = utftext.charCodeAt(i + 1);
            string += String.fromCharCode((c & 31) << 6 | c2 & 63);
            i += 2;
          } else {
            c2 = utftext.charCodeAt(i + 1);
            c3 = utftext.charCodeAt(i + 2);
            string += String.fromCharCode((c & 15) << 12 | (c2 & 63) << 6 | c3 & 63);
            i += 3;
          }
        }

        return string;
      }
    };

    if (!window.Conekta) {
      window.Conekta = {
        b64: Base64,

        setLanguage: function setLanguage(language) {
          return _language = language;
        },

        getLanguage: function getLanguage() {
          return _language;
        },

        setPublicKey: function setPublicKey(key) {
          if (typeof key === 'string' && key.match(/^[a-zA-Z0-9_]*$/) && key.length >= 20 && key.length < 30) {
            public_key = key;

            localstorageSet('_conekta_publishable_key', public_key);

            getAntifraudConfig();
          } else {
            Conekta._helpers.log('Unusable public key: ' + key);
          }
        },

        setPublishableKey: function setPublishableKey(key) {
          console.warn('setPublishableKey is going to be deprecated on version 2.0.0');
          return this.setPublicKey(key);
        },

        getPublicKey: function getPublicKey() {
          return public_key;
        },

        getPublishableKey: function getPublishableKey() {
          console.warn('setPublishableKey is going to be deprecated on version 2.0.0');
          return this.getPublicKey();
        },

        _helpers: {
          beacon_sent: false,
          objectKeys: function objectKeys(obj) {
            var keys, p;

            keys = [];

            for (p in obj) {
              if (Object.prototype.hasOwnProperty.call(obj, p)) {
                keys.push(p);
              }
            }

            return keys;
          },

          parseForm: function parseForm(form_object) {
            var all_inputs, attribute, attribute_name, attributes, input, inputs, json_object, l, last_attribute, len, len1, m, node, o, parent_node, q, r, ref1, ref2, ref3, selects, textareas, val;

            json_object = {};

            if ((typeof form_object === 'undefined' ? 'undefined' : _typeof(form_object)) === 'object') {
              if (typeof jQuery !== 'undefined' && (form_object instanceof jQuery || 'jquery' in Object(form_object))) {
                form_object = form_object.get()[0];

                if ((typeof form_object === 'undefined' ? 'undefined' : _typeof(form_object)) !== 'object') {
                  return {};
                }
              }
              if (form_object.nodeType) {
                textareas = form_object.getElementsByTagName('textarea');
                inputs = form_object.getElementsByTagName('input');
                selects = form_object.getElementsByTagName('select');

                all_inputs = new Array(textareas.length + inputs.length + selects.length);

                for (i = l = 0, ref1 = textareas.length - 1; l <= ref1; i = l += 1) {
                  all_inputs[i] = textareas[i];
                }

                for (i = m = 0, ref2 = inputs.length - 1; m <= ref2; i = m += 1) {
                  all_inputs[i + textareas.length] = inputs[i];
                }

                for (i = o = 0, ref3 = selects.length - 1; o <= ref3; i = o += 1) {
                  all_inputs[i + textareas.length + inputs.length] = selects[i];
                }

                for (q = 0, len = all_inputs.length; q < len; q++) {
                  input = all_inputs[q];

                  if (input) {
                    attribute_name = input.getAttribute('data-conekta');

                    if (attribute_name) {
                      if (input.tagName === 'SELECT') {
                        val = input.value;
                      } else {
                        val = input.getAttribute('value') || input.innerHTML || input.value;
                      }

                      attributes = attribute_name.replace(/\]/g, '').replace(/\-/g, '_').split(/\[/);

                      parent_node = null;
                      node = json_object;
                      last_attribute = null;

                      for (r = 0, len1 = attributes.length; r < len1; r++) {
                        attribute = attributes[r];

                        if (!node[attribute]) {
                          node[attribute] = {};
                        }

                        parent_node = node;
                        last_attribute = attribute;
                        node = node[attribute];
                      }
                      parent_node[last_attribute] = val;
                    }
                  }
                }
              } else {
                json_object = form_object;
              }

              if (json_object.details && json_object.details.line_items && Object.prototype.toString.call(json_object.details.line_items) !== '[object Array]' && _typeof(json_object.details.line_items) === 'object') {
                var line_items = [];

                for (var key in json_object.details.line_items) {
                  line_items.push(json_object.details.line_items[key]);
                }

                json_object.details.line_items = line_items;
              }
            }
            return json_object;
          },

          getSessionId: function getSessionId() {
            return session_id;
          },

          xDomainPost: function xDomainPost(params) {
            var error_callback, rpc, success_callback;

            success_callback = function success_callback(data, textStatus, jqXHR) {
              // eslint-disable-line no-unused-vars
              if (!data || data.object === 'error' || !data.id) {

                if (!data.message_to_purchaser) {
                  logError(JSON.stringify(data));
                }

                return params.error(data || {
                  object: 'error',
                  type: 'api_error',
                  message: "Something went wrong on Conekta's end",
                  message_to_purchaser: "Your code could not be processed, please try again later"
                });
              } else {
                return params.success(data);
              }
            };

            error_callback = function error_callback(jqXHR) {
              if (jqXHR && jqXHR.status) {
                logError('Error response status: ' + jqXHR.status);
              }

              return params.error({
                object: 'error',
                type: 'api_error',
                message: 'Something went wrong, possibly a connectivity issue',
                message_to_purchaser: "Your code could not be processed, please try again later"
              });
            };

            if (document.location.protocol === 'file:' && navigator.userAgent.indexOf("MSIE") !== -1) {
              params.url = (params.jsonp_url || params.url) + '/' + params.action + '.js';

              params.data['_Version'] = ConektaVersion.api;
              params.data['_RaiseHtmlError'] = false;
              params.data['auth_token'] = Conekta.getPublicKey();
              params.data['conekta_client_user_agent'] = '{"agent":"Conekta JavascriptBindings-JSONP/' + ConektaVersion.version + ' build ' + ConektaVersion.build + '"}';

              return conektaAjax({
                url: base_url + params.url,
                dataType: 'jsonp',
                data: params.data,
                success: success_callback,
                error: error_callback
              });
            } else {
              if (typeof new XMLHttpRequest().withCredentials !== 'undefined') {
                return conektaAjax({
                  url: base_url + params.url,
                  type: params.action === 'update' ? 'PUT' : 'POST',
                  dataType: 'json',
                  data: JSON.stringify(params.data),
                  contentType: 'application/json',
                  headers: {
                    'RaiseHtmlError': false,
                    'Accept': 'application/vnd.conekta-v' + ConektaVersion.api + '+json',
                    'Accept-Language': Conekta.getLanguage(),
                    'Conekta-Client-User-Agent': '{"agent":"Conekta JavascriptBindings-AJAX/' + ConektaVersion.version + ' build ' + ConektaVersion.build + '"}',
                    'Authorization': 'Basic ' + Base64.encode(Conekta.getPublicKey() + ':')
                  },
                  success: success_callback,
                  error: error_callback
                });
              } else {
                rpc = new easyXDM.Rpc({
                  swf: "https://conektaapi.s3.amazonaws.com/v0.3.2/flash/easyxdm.swf",
                  remote: base_url + "easyxdm_cors_proxy.html"
                }, {
                  remote: {
                    request: {}
                  }
                });
                return rpc.request({
                  url: base_url + params.url,
                  method: params.action === 'update' ? 'PUT' : 'POST',
                  headers: {
                    'RaiseHtmlError': false,
                    'Accept': 'application/vnd.conekta-v' + ConektaVersion.api + '+json',
                    'Accept-Language': Conekta.getLanguage(),
                    'Conekta-Client-User-Agent': '{"agent":"Conekta JavascriptBindings-XDM/' + ConektaVersion.version + ' build ' + ConektaVersion.build + '"}',
                    'Authorization': 'Basic ' + Base64.encode(Conekta.getPublicKey() + ':')
                  },
                  data: JSON.stringify(params.data)
                }, success_callback, function (error) {
                  logError('easyXDM error -> ' + error);

                  return params.error({
                    object: 'error',
                    type: 'api_error',
                    message: 'Something went wrong, possibly a connectivity issue',
                    message_to_purchaser: "Your code could not be processed, please try again later"
                  });
                });
              }
            }
          },

          log: function log(data) {
            if (typeof console !== 'undefined' && console.log) {
              return console.log(data);
            }
          },

          querySelectorAll: function querySelectorAll(selectors) {
            var element, elements, style;

            if (!document.querySelectorAll) {
              style = document.createElement('style');
              elements = [];
              document.documentElement.firstChild.appendChild(style);
              document._qsa = [];

              if (style.styleSheet) {
                style.styleSheet.cssText = selectors + '{x-qsa:expression(document._qsa && document._qsa.push(this))}';
              } else {
                style.style.cssText = selectors + '{x-qsa:expression(document._qsa && document._qsa.push(this))}';
              }

              window.scrollBy(0, 0);
              style.parentNode.removeChild(style);

              while (document._qsa.length) {
                element = document._qsa.shift();
                element.style.removeAttribute('x-qsa');
                elements.push(element);
              }

              document._qsa = null;

              return elements;
            } else {
              return document.querySelectorAll(selectors);
            }
          },

          querySelector: function querySelector(selectors) {
            var elements;

            if (!document.querySelector) {
              elements = this.querySelectorAll(selectors);

              if (elements.length > 0) {
                return elements[0];
              } else {
                return null;
              }
            } else {
              return document.querySelector(selectors);
            }
          }
        }
      };
      if (Conekta._helpers.querySelectorAll('script[data-conekta-session-id]').length > 0) {
        $tag = Conekta._helpers.querySelectorAll('script[data-conekta-session-id]')[0];
        session_id = $tag.getAttribute('data-conekta-session-id');
      }
      if (Conekta._helpers.querySelectorAll('script[data-conekta-public-key]').length > 0) {
        $tag = Conekta._helpers.querySelectorAll('script[data-conekta-public-key]')[0];
        window.Conekta.setPublicKey($tag.getAttribute('data-conekta-public-key'));
      }
    }
  } catch (error) {
    logError(error);
  }
}).call(undefined);

'use strict';

/*global Conekta*/

(function () {
  var accepted_cards,
      card_types,
      get_card_type,
      is_valid_length,
      is_valid_luhn,
      parseMonth,
      parseYear,
      minYear,
      maxYear,
      indexOf = [].indexOf || function (item) {
    for (var i = 0, l = this.length; i < l; i++) {
      if (i in this && this[i] === item) return i;
    }return -1;
  };

  card_types = [{
    name: 'amex',
    pattern: /^3[47]/,
    valid_length: [15]
  }, {
    name: 'diners_club_carte_blanche',
    pattern: /^30[0-5]/,
    valid_length: [14]
  }, {
    name: 'diners_club_international',
    pattern: /^36/,
    valid_length: [14]
  }, {
    name: 'jcb',
    pattern: /^35(2[89]|[3-8][0-9])/,
    valid_length: [16]
  }, {
    name: 'laser',
    pattern: /^(6304|670[69]|6771)/,
    valid_length: [16, 17, 18, 19]
  }, {
    name: 'visa_electron',
    pattern: /^4(026|17500|405|508|844|91[37])/,
    valid_length: [16]
  }, {
    name: 'visa',
    pattern: /^4/,
    valid_length: [16]
  }, {
    name: 'mastercard',
    pattern: /^(5[1-5]|677189)|^(222[1-9]|2[3-6]\d{2}|27[0-1]\d|2720)/,
    valid_length: [16]
  }, {
    name: 'maestro',
    pattern: /^(5018|5020|5038|6304|6759|6761|6763)/,
    valid_length: [12, 13, 14, 15, 16, 17, 18, 19]
  }, {
    name: 'discover',
    pattern: /^(6011|622(12[6-9]|1[3-9][0-9]|[2-8][0-9]{2}|9[0-1][0-9]|92[0-5]|64[4-9])|65)/, // eslint-disable-line max-len
    valid_length: [16]
  }, {
    name: 'pagaflex',
    pattern: /^(636937[0-1][0-9])/,
    valid_length: [16]
  }, {
    name: 'carnet',
    pattern: /^(639559|506221|50643[6-7])/,
    valid_length: [16]
  }, {
    name: 'sivale',
    pattern: /^(627636)/,
    valid_length: [16]
  }];

  is_valid_luhn = function is_valid_luhn(number) {
    var digit, i, len, n, ref, sum;
    sum = 0;
    ref = number.split('').reverse();
    for (n = i = 0, len = ref.length; i < len; n = ++i) {
      digit = ref[n];
      digit = +digit;
      if (n % 2) {
        digit *= 2;
        if (digit < 10) {
          sum += digit;
        } else {
          sum += digit - 9;
        }
      } else {
        sum += digit;
      }
    }
    return sum % 10 === 0;
  };

  is_valid_length = function is_valid_length(number, card_type) {
    var ref;
    return ref = number.length, indexOf.call(card_type.valid_length, ref) >= 0;
  };

  accepted_cards = ['visa', 'mastercard', 'maestro', 'visa_electron', 'amex', 'laser', 'diners_club_carte_blanche', 'diners_club_international', 'discover', 'jcb', 'carnet', 'pagaflex', 'sivale'];

  get_card_type = function get_card_type(number) {
    var card, card_type, i, len, ref;
    ref = function () {
      var j, len, ref, results;
      results = [];
      for (j = 0, len = card_types.length; j < len; j++) {
        card = card_types[j];
        if (ref = card.name, indexOf.call(accepted_cards, ref) >= 0) {
          results.push(card);
        }
      }
      return results;
    }();
    for (i = 0, len = ref.length; i < len; i++) {
      card_type = ref[i];
      if (number.match(card_type.pattern)) {
        return card_type;
      }
    }
    return null;
  };

  parseMonth = function parseMonth(month) {
    if (typeof month === 'string' && month.match(/^[\d]{1,2}$/)) {
      return parseInt(month);
    } else {
      return month;
    }
  };

  parseYear = function parseYear(year) {
    if (typeof year === 'number' && year < 100) {
      year += 2000;
    }
    if (typeof year === 'string' && year.match(/^([\d]{2,2}|20[\d]{2,2})$/)) {
      if (year.match(/^([\d]{2,2})$/)) {
        year = '20' + year;
      }
      return parseInt(year);
    } else {
      return year;
    }
  };

  minYear = function minYear() {
    return new Date().getFullYear() - 1;
  };

  maxYear = function maxYear() {
    return new Date().getFullYear() + 22;
  };

  Conekta.card = {};

  Conekta.card.getBrand = function (number) {
    var brand;
    if (typeof number === 'string') {
      number = number.replace(/[ -]/g, '');
    } else if (typeof number === 'number') {
      number = toString(number);
    }
    brand = get_card_type(number);
    if (brand && brand.name) {
      return brand.name;
    }
    return null;
  };

  Conekta.card.validateCVC = function (cvc) {
    return typeof cvc === 'number' && cvc >= 0 && cvc < 10000 || typeof cvc === 'string' && cvc.match(/^[\d]{3,4}$/) !== null;
  };

  Conekta.card.validateExpMonth = function (exp_month) {
    var month;
    month = parseMonth(exp_month);
    return typeof month === 'number' && month > 0 && month < 13;
  };

  Conekta.card.validateExpYear = function (exp_year) {
    var year;
    year = parseYear(exp_year);
    return typeof year === 'number' && year > minYear() && year < maxYear();
  };

  Conekta.card.validateExpirationDate = function (exp_month, exp_year) {
    var month, year;
    month = parseMonth(exp_month);
    year = parseYear(exp_year);
    if (typeof month === 'number' && month > 0 && month < 13 && typeof year === 'number' && year > minYear() && year < maxYear()) {
      return new Date(year, month, new Date(year, month, 0).getDate()) > new Date();
    } else {
      return false;
    }
  };

  Conekta.card.validateExpiry = function (exp_month, exp_year) {
    return Conekta.card.validateExpirationDate(exp_month, exp_year);
  };

  Conekta.card.validateName = function (name) {
    return typeof name === 'string' && name.match(/^\s*[A-z]+\s+[A-z]+[\sA-z]*$/) !== null && name.match(/visa|master\s*card|amex|american\s*express|banorte|banamex|bancomer|hsbc|scotiabank|jcb|diners\s*club|discover/i) === null; // eslint-disable-line max-len
  };

  Conekta.card.validateNumber = function (number) {
    var card_type, length_valid, luhn_valid;
    if (typeof number === 'string') {
      number = number.replace(/[ -]/g, '');
    } else if (typeof number === 'number') {
      number = number.toString();
    } else {
      number = "";
    }
    card_type = get_card_type(number);
    luhn_valid = false;
    length_valid = false;
    if (card_type != null) {
      luhn_valid = is_valid_luhn(number);
      length_valid = is_valid_length(number, card_type);
    }
    return luhn_valid && length_valid;
  };

  Conekta.Card = Conekta.card;
}).call(undefined);

(function () {
  Conekta.charge = {};

  Conekta.charge.create = function (charge_form, success_callback, failure_callback) {
    var charge;
    if (typeof success_callback !== 'function') {
      success_callback = Conekta._helpers.log;
    }
    if (typeof failure_callback !== 'function') {
      failure_callback = Conekta._helpers.log;
    }
    charge = Conekta._helpers.parseForm(charge_form);
    if (typeof charge === 'object') {
      if (Conekta._helpers.objectKeys(charge).length > 0) {
        charge.session_id = Conekta._helpers.getSessionId();
        if (charge.card && charge.card.address && !(charge.card.address.street1 || charge.card.address.street2 || charge.card.address.street3 || charge.card.address.city || charge.card.address.state || charge.card.address.country || charge.card.address.zip)) {
          delete charge.card.address;
        }
        return Conekta._helpers.xDomainPost({
          jsonp_url: 'charges',
          url: 'charges',
          data: charge,
          success: success_callback,
          error: failure_callback
        });
      } else {
        return failure_callback({
          'object': 'error',
          'type': 'invalid_request_error',
          'message': "Supplied parameter 'charge' is usable object but has no values (e.g. amount, description) associated with it",
          'message_to_purchaser': "The card could not be processed, please try again later"
        });
      }
    } else {
      return failure_callback({
        'object': 'error',
        'type': 'invalid_request_error',
        'message': "Supplied parameter 'charge' is not a javascript object",
        'message_to_purchaser': "The card could not be processed, please try again later"
      });
    }
  };

}).call(this);

/*global Conekta*/
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

(function () {
  Conekta.Token = {};

  var makeRequest = function makeRequest(action, token_form, success_callback, failure_callback) {
    var token;
    if (typeof success_callback !== 'function') {
      success_callback = Conekta._helpers.log;
    }
    if (typeof failure_callback !== 'function') {
      failure_callback = Conekta._helpers.log;
    }
    token = Conekta._helpers.parseForm(token_form);
    if ((typeof token === 'undefined' ? 'undefined' : _typeof(token)) === 'object') {
      if (Conekta._helpers.objectKeys(token).length > 0) {
        if (token.card) {
          token.card.device_fingerprint = Conekta._helpers.getSessionId();
        } else {
          failure_callback({
            'object': 'error',
            'type': 'invalid_request_error',
            'message': "The form or hash has no attributes 'card'.  If you are using a form, please ensure that you have have an input or text area with the data-conekta attribute 'card[number]'.  For an example form see: https://github.com/conekta/conekta.js/blob/master/examples/credit_card.html", // eslint-disable-line max-len
            'message_to_purchaser': "The card could not be processed, please try again later"
          });
        }
        if (token.card && token.card.address && !(token.card.address.street1 || token.card.address.street2 || token.card.address.street3 || token.card.address.city || token.card.address.state || token.card.address.country || token.card.address.zip)) {
          delete token.card.address;
        }

        var url = 'tokens';
        if (action === 'update') {
          if (!token['token_id']) {
            return failure_callback({
              'object': 'error',
              'type': 'invalid_request_error',
              'message': "The token_id parameter is required for update token.",
              'message_to_purchaser': "The card could not be processed, please try again later"
            });
          }

          url = 'tokens/' + token['token_id'];
        }

        return Conekta._helpers.xDomainPost({
          jsonp_url: url,
          url: url,
          action: action,
          data: token,
          success: success_callback,
          error: failure_callback
        });
      } else {
        return failure_callback({
          'object': 'error',
          'type': 'invalid_request_error',
          'message': "supplied parameter 'token' is usable object but has no values (e.g. amount, description) associated with it", // eslint-disable-line max-len
          'message_to_purchaser': "The card could not be processed, please try again later"
        });
      }
    } else {
      return failure_callback({
        'object': 'error',
        'type': 'invalid_request_error',
        'message': "Supplied parameter 'token' is not a javascript object or a form",
        'message_to_purchaser': "The card could not be processed, please try again later"
      });
    }
  };

  Conekta.Token.update = function (token_form, success_callback, failure_callback) {
    return makeRequest('update', token_form, success_callback, failure_callback);
  };

  Conekta.Token.create = function (token_form, success_callback, failure_callback) {
    return makeRequest('create', token_form, success_callback, failure_callback);
  };

  Conekta.token = {};

  Conekta.token.create = Conekta.Token.create;
  Conekta.token.update = Conekta.Token.update;
}).call(undefined);
