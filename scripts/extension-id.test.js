import assert from "node:assert/strict";
import test from "node:test";
import {
  UTILS_EXTENSION_ID,
  extensionIdFromChromeKey,
  findUnpackedInstall,
} from "./extension-id.js";

const SAMPLE_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA49zjaYcSVaR0yJDty20MrTFngBy8dNsWnHBZ6p/eORVc+DikHsvV92k3f73Jdg6wNo2pto+W9wjtGoGJ/pDaFgE0Afqp0+W1qsxFOiEpNcmFgbToQk0or85vmHTLoapQiT/caxh7hK8zPXYPNRJ77sddMc54+vuASxWlra8oVKVsRhhqQJ351e5lvMoTmBHYW2Bla7OuFgfAUXSdsOB2OSLlZ6iPhGBdRPgdw/T9BzcYGguqx+fYHJWjS7oYN5Oq0KUgtA7oLVGyyz2/Aah4+9QegF1h/UIubQscNX9ELZjW8o+xxxuIKByIbXWl1W2IvGV1tCPCX4W+bD+ldQ2+HQIDAQAB";

test("extensionIdFromChromeKey maps the committed Utils public key", () => {
  assert.equal(extensionIdFromChromeKey(SAMPLE_KEY), "ehjdfopanjodgalngpkkflldabbjflmh");
  assert.equal(UTILS_EXTENSION_ID, "ehjdfopanjodgalngpkkflldabbjflmh");
});

test("findUnpackedInstall matches a loc-4 path or the stable id", () => {
  const settings = {
    ehjdfopanjodgalngpkkflldabbjflmh: {
      location: 4,
      path: "C:\\Users\\lverg\\Projects\\chrome-extentions\\utils",
      disable_reasons: [],
    },
  };
  const found = findUnpackedInstall(settings, {
    id: UTILS_EXTENSION_ID,
    path: "C:\\Users\\lverg\\Projects\\chrome-extentions\\utils",
  });
  assert.equal(found.id, UTILS_EXTENSION_ID);
  assert.equal(found.enabled, true);
});

test("findUnpackedInstall ignores store copies and missing installs", () => {
  const settings = {
    akmdionenlnfcipmdhbhcnkighafmdha: {
      location: 1,
      path: "akmdionenlnfcipmdhbhcnkighafmdha\\15.19_0",
    },
  };
  assert.equal(
    findUnpackedInstall(settings, {
      id: UTILS_EXTENSION_ID,
      path: "C:\\Users\\lverg\\Projects\\chrome-extentions\\utils",
    }),
    null,
  );
});
