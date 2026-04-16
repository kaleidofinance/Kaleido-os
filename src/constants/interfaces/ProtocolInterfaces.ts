export interface IUseCloseListingAd {
  closeListingAd: (listingId: number) => Promise<void>;
}

export interface IUseCloseRequest {
  closeRequest: (listingId: number) => Promise<void>;   
}