// Runs before first paint. Never interpolate storage values into executable code.
export const themeBootstrapScript = `(function(){var t="dark";try{if(localStorage.getItem("aura-color-theme")==="light")t="light";}catch(e){}document.documentElement.dataset.theme=t;})();`;
