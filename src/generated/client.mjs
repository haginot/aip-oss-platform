// Generated from config/ontology.json; ontology 1.0.0; digest be41eac5ff6e6d358b3af32d3d539d752dc21542d0a8de0ff9ea552cada9bc06.
import {createContractClient} from '../client-transport.mjs';
export const definition = {
  "contractVersion": "1.0.0",
  "ontologyVersion": "1.0.0",
  "policyVersion": "1.0.0",
  "ruleVersion": "1.0.0",
  "workflowVersion": "1.0.0",
  "types": {
    "Store": {
      "fields": {
        "name": {
          "type": "string"
        },
        "secret": {
          "type": "string",
          "restricted": true
        }
      }
    },
    "Lot": {
      "fields": {
        "name": {
          "type": "string"
        },
        "secret": {
          "type": "string",
          "restricted": true
        }
      }
    },
    "InventoryPosition": {
      "fields": {
        "name": {
          "type": "string"
        },
        "quantity": {
          "type": "integer",
          "unit": "each"
        },
        "isolated": {
          "type": "boolean"
        },
        "note": {
          "type": "string",
          "nullable": true
        },
        "secret": {
          "type": "string",
          "restricted": true
        }
      }
    }
  },
  "links": {
    "stock": {
      "from": "Lot",
      "to": "InventoryPosition"
    },
    "storeStock": {
      "from": "Store",
      "to": "InventoryPosition"
    }
  },
  "actions": {
    "SetIsolation": {
      "version": "1.0.0",
      "targetType": "InventoryPosition",
      "input": {
        "targetId": {
          "type": "string"
        },
        "isolated": {
          "type": "boolean"
        }
      }
    }
  }
};
export function createClient(options) { return createContractClient(options,definition); }
