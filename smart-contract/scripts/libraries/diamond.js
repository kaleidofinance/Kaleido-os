const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 }



/**
 * Every function selector in a contract's ABI, for a diamond cut.
 *
 * Reads `.selector` off each FunctionFragment rather than re-resolving by name
 * through `interface.getFunction(f.name)`. The name lookup is ambiguous for
 * overloaded functions and ethers v6 throws on it — "ambiguous function
 * description (i.e. matches foo(uint256), foo(address))" — which would abort the
 * deploy on the first facet that overloads anything. None of the five current
 * facets does, so this was latent rather than broken, but the fragment already
 * carries the selector and cannot be ambiguous about which overload it means.
 *
 * Does not log: the caller names the facet it is deploying, and this function
 * only ever saw `contract.name`, which is undefined on an ethers v6 Contract —
 * so the line it used to print read "✅ undefined selectors:" directly above the
 * caller's correct one.
 */
function getSelectors(contract) {
  if (!contract.interface || !contract.interface.fragments) {
    return [];
  }

  return contract.interface.fragments
    .filter((f) => f.type === "function")
    .map((f) => f.selector);
}


// get function selector from function signature
function getSelector(func) {
  const abiInterface = new ethers.utils.Interface([func])
  return abiInterface.getSighash(ethers.utils.Fragment.from(func))
}

// used with getSelectors to remove selectors from an array of selectors
// functionNames argument is an array of function signatures
function remove(functionNames) {
  const selectors = this.filter((v) => {
    for (const functionName of functionNames) {
      if (v === this.contract.interface.getSighash(functionName)) {
        return false
      }
    }
    return true
  })
  // selectors.contract = this.contract
  // selectors.remove = this.remove
  // selectors.get = this.get
  return selectors
}

// used with getSelectors to get selectors from an array of selectors
// functionNames argument is an array of function signatures
function get(functionNames) {
  const selectors = this.filter((v) => {
    for (const functionName of functionNames) {
      if (v === this.contract.interface.getSighash(functionName)) {
        return true
      }
    }
    return false
  })
  // selectors.contract = this.contract
  // selectors.remove = this.remove
  // selectors.get = this.get
  return selectors
}

// remove selectors using an array of signatures
function removeSelectors(selectors, signatures) {
  const iface = new ethers.utils.Interface(
    signatures.map((v) => 'function ' + v),
  )
  const removeSelectors = signatures.map((v) => iface.getSighash(v))
  selectors = selectors.filter((v) => !removeSelectors.includes(v))
  return selectors
}

// find a particular address position in the return value of diamondLoupeFacet.facets()
function findAddressPositionInFacets(facetAddress, facets) {
  for (let i = 0; i < facets.length; i++) {
    if (facets[i].facetAddress === facetAddress) {
      return i
    }
  }
}

exports.getSelectors = getSelectors
exports.getSelector = getSelector
exports.FacetCutAction = FacetCutAction
exports.remove = remove
exports.removeSelectors = removeSelectors
exports.findAddressPositionInFacets = findAddressPositionInFacets
