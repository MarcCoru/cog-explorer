import urlJoin from 'url-join';
import { fromUrl } from 'geotiff/src/main';

import types from '../../types';
import { startLoading, stopLoading } from '../main';

const {
  SCENE_ADD, SCENE_REMOVE, SCENE_CHANGE_BANDS,
  SCENE_PIPELINE_ADD_STEP, SCENE_PIPELINE_REMOVE_STEP, SCENE_PIPELINE_INDEX_STEP,
  SCENE_PIPELINE_EDIT_STEP, SET_ERROR,
} = types;


const urlToAttribution = {
  'https://s3-us-west-2.amazonaws.com/planet-disaster-data/hurricane-harvey/SkySat_Freeport_s03_20170831T162740Z3.tif': 'cc-by-sa, downloaded from https://www.planet.com/disaster/hurricane-harvey-2017-08-28/',
};


export function addScene(url, bands, bandLabels, redBand, greenBand, blueBand, isSingle, hasOvr, isRGB, attribution, title, pipeline = []) {
  return {
    type: SCENE_ADD,
    sceneId: url,
    bands,
    bandLabels,
    redBand,
    greenBand,
    blueBand,
    isSingle,
    hasOvr,
    isRGB,
    attribution: attribution || urlToAttribution[url],
    title: title || url,
    pipeline,
  };
}

export function sceneChangeBands(url, newBands) {
  return {
    type: SCENE_CHANGE_BANDS,
    sceneId: url,
    newBands,
  };
}

export function removeScene(url) {
  return {
    type: SCENE_REMOVE,
    sceneId: url,
  };
}

export function setError(message = null) {
  return {
    type: SET_ERROR,
    message,
  };
}

const landsat8Pipeline = [
  {
    operation: 'sigmoidal-contrast',
    contrast: 50,
    bias: 0.16,
  }, {
    operation: 'gamma',
    bands: 'red',
    value: 1.03,
  }, {
    operation: 'gamma',
    bands: 'blue',
    value: 0.925,
  },
];

export function addSceneFromIndex(url, attribution, pipeline) {
  return async (dispatch, getState) => {
    const { scenes } = getState();

    // remove old scenes
    for (const scene of scenes) {
      dispatch(removeScene(scene.id));
    }

    // clear previous error
    dispatch(setError());

    dispatch(startLoading());
    try {
      // find out type of data the URL is pointing to
      const headerResponse = await fetch(url, { method: 'HEAD' });

      if (!headerResponse.ok) {
        throw new Error(`Failed to fetch ${url}`);
      }

      const contentType = headerResponse.headers.get('content-type');

      if (contentType === 'text/html') {
        const relUrl = url.endsWith('/') ? url : url.substring(0, url.lastIndexOf('/'));
        const response = await fetch(url, {});
        const content = await response.text();
        const doc = (new DOMParser()).parseFromString(content, 'text/html');
        const files = Array.from(doc.querySelectorAll('a[href]'))
          .map(a => a.getAttribute('href'))
          .map(file => urlJoin(relUrl, file));

        let usedPipeline = pipeline;
        let red = 0;
        let green = 0;
        let blue = 0;
        let bands;

        if (files.find(file => /LC0?8.*B[0-9]+.TIF$/.test(file))) {
          // landsat case
          red = 4;
          green = 3;
          blue = 2;
          bands = new Map(
            files
              .filter(file => /LC0?8.*B[0-9]+.TIF$/.test(file))
              .map(file => [parseInt(/.*B([0-9]+).TIF/.exec(file)[1], 10), file]),
          );

          usedPipeline = usedPipeline || landsat8Pipeline;
        } else {
          bands = new Map(
            files
              .filter(file => /.TIFF?$/gi.test(file))
              .map((file, i) => [i, file]),
          );
        }

        const hasOvr = typeof files.find(file => /.TIFF?.OVR$/i.test(file)) !== 'undefined';
        dispatch(
          addScene(
            url, bands, false, red, green, blue, false, hasOvr, false, attribution, false, usedPipeline
          )
        );
      } else if (contentType === 'image/tiff') {
        const tiff = await fromUrl(url);
        const image = await tiff.getImage();

        const samples = image.getSamplesPerPixel();
        const bands = new Map();
        for (let i = 0; i < samples; ++i) {
          bands.set(i, url);
        }

        let [red, green, blue] = [];
        if (samples === 3 || typeof image.fileDirectory.PhotometricInterpretation !== 'undefined') {
          red = 0;
          green = 1;
          blue = 2;
        } else {
          red = 0;
          green = 0;
          blue = 0;
        }

        const isRGB = (
          typeof image.fileDirectory.PhotometricInterpretation !== 'undefined'
          && image.getSampleByteSize(0) === 1
        );

        dispatch(addScene(url, bands, false, red, green, blue, true, false, isRGB, attribution, false, false, pipeline));
      } else if (contentType === 'application/json') {
        const relUrl = url.endsWith('/') ? url : url.substring(0, url.lastIndexOf('/'));
        const response = await fetch(url, {});
        const stacJSON = await response.json();


        let files = [];
        for (const key in stacJSON.assets) {
          if (Object.prototype.hasOwnProperty.call(stacJSON.assets, key)) {
            const asset = stacJSON.assets[key];
            if (asset.type === 'image/x.geotiff' || asset.type === 'image/geotiff') {
              files.push({
                title: asset.title,
                href: asset.href,
              });
            }
          }
        }

        let usedPipeline = pipeline;
        let red = 0;
        let green = 0;
        let blue = 0;
        let bands;


        bands = new Map(
          files.map((file, i) => [i, file.href]),
        );

        const bandLabels = new Map(
          files.map((file, i) => [i, file.title]),
        );

        let id = url;
        if (stacJSON.hasOwnProperty('properties')) {
          if (stacJSON.properties.hasOwnProperty('collection') && 
              stacJSON.hasOwnProperty('id')) {
            id = stacJSON.properties.collection + '_' + stacJSON.id;
          }
        } else if (stacJSON.hasOwnProperty('id')) {
          id = stacJSON.id;
        }

        // TODO: Temporary overwrite of has overview value to true
        //       Either will not be necessary in the future using cog geotiffs
        //       or information about overview must be read from the STAC file
        const hasOvr = true; /* typeof files.find(file => /.TIFF?.OVR?.tiff$/i.test(file)) !== 'undefined' */
        dispatch(
          addScene(
            url, bands, bandLabels, red, green, blue, false,
            hasOvr, false, attribution, id, usedPipeline,
          ),
        );
      }
    } catch (error) {
      // TODO: set error somewhere to present to user
      dispatch(setError(error.toString()));
    } finally {
      dispatch(stopLoading());
    }
  };
}

export function addStep(url, operation) {
  let values;
  switch (operation) {
    case 'sigmoidal-contrast':
      values = {
        contrast: 50,
        bias: 0.15,
      };
      break;
    case 'gamma':
      values = { value: 1.0 };
      break;
    case 'linear':
      values = {
        min: 0.0,
        max: 1.0,
      };
      break;
    default:
      values = {};
      break;
  }
  return {
    type: SCENE_PIPELINE_ADD_STEP,
    sceneId: url,
    payload: {
      operation,
      ...values,
    },
  };
}

export function editStep(url, index, payload) {
  return {
    type: SCENE_PIPELINE_EDIT_STEP,
    sceneId: url,
    index,
    payload,
  };
}

export function indexStep(url, index, newIndex) {
  return {
    type: SCENE_PIPELINE_INDEX_STEP,
    sceneId: url,
    index,
    newIndex,
  };
}

export function removeStep(url, index) {
  return {
    type: SCENE_PIPELINE_REMOVE_STEP,
    sceneId: url,
    index,
  };
}
