declare module "searoute-js" {
  function searoute(
    from: GeoJSON.Feature<GeoJSON.Point>,
    to: GeoJSON.Feature<GeoJSON.Point>,
    options?: { units?: string }
  ): GeoJSON.Feature<GeoJSON.LineString>;
  export default searoute;
}
