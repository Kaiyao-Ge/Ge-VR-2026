export default () => {
   return {
      enableSceneReloading: true,
      scenes: [ 
            { name: "simple"   , path: "./simple.js"  , public: true },
            { name: "shapes"   , path: "./shapes.js"  , public: true },
      ]
   };
}
