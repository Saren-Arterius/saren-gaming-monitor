const porcupineModel = {
  publicPath: "vendor/porcupine/models/porcupine_params.pv",
  customWritePath: "4.0.0_porcupine_params.pv",
};

(function () {
  if (typeof module !== "undefined" && typeof module.exports !== "undefined")
    module.exports = porcupineModel;
})();