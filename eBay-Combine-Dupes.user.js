// ==UserScript==
// @name         eBay - Combine Dupes
// @namespace    https://github.com/LenAnderson/
// @downloadURL  https://github.com/LenAnderson/eBay-Combine-Dupes/raw/master/eBay-Combine-Dupes.user.js
// @version      0.1
// @description  Combine duplicate entries on a search result page by comparing images.
// @author       LenAnderson
// @match        *://www.ebay.*/sch/i.html*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    var imgs = [];
    var proms = [];
    [].forEach.call(document.querySelectorAll('#ListViewInner > li > .lvpic.pic.img > .lvpicinner > .img > img'), function(img) {
        proms.push(new Promise(function(resolve, reject) {
            if (img.getAttribute('imgurl')) {
                img.src = img.getAttribute('imgurl');
            } else if (img.naturalHeight > 0) {
                resolve();
            }
            img.addEventListener('load', resolve);
            img.addEventListener('error', resolve);
        }));
    });
    Promise.all(proms).then(function() {
        console.log('GO!');
        [].forEach.call(document.querySelectorAll('#ListViewInner > li > .lvpic.pic.img > .lvpicinner > .img > img'), function(img) {
            if (imgs.length == 0) {
                imgs.push(getImageData(img));
            } else {
                var imgData = getImageData(img);
                var found = false;
                console.log('\t', imgs.length);
                for(var i=0;i<imgs.length;i++) {
                    try {
                        var diff = pixelmatch(imgs[i].data, imgData.data, null, img.naturalWidth, img.naturalHeight, {stepX:2,stepY:2});
                        if (diff <= 0) {
                            imgs[i].dupes.push(img);
                            img.parentNode.parentNode.parentNode.parentNode.remove();
                            found = true;
                        }
                    } catch (ex) {}
                }
                if (!found) {
                    imgs.push(imgData);
                }
            }
        });
        imgs.forEach(function(img) {
            var li = img.img.parentNode.parentNode.parentNode.parentNode;
            var title = li.querySelector('h3.lvtitle');
            img.dupes.forEach(function(dupe) {
                var h3 = dupe.parentNode.parentNode.parentNode.parentNode.querySelector('h3.lvtitle');
                h3.style.fontSize = '8px';
                title.parentNode.insertBefore(h3, title.nextElementSibling);
            });
        });
        console.log('DONE!');
    });

    function getImageData(img) {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0,0, img.naturalWidth, img.naturalHeight, 0,0,50,50);
        return {img:img, dupes:[], data:ctx.getImageData(0,0, 50,50).data};
    }

    function pixelmatch(img1, img2, output, width, height, options) {
        if (img1.length !== img2.length) throw new Error('Image sizes do not match.');
        if (!options) options = {stepX:1, stepY:1};

        var threshold = options.threshold === undefined ? 0.1 : options.threshold;
        // maximum acceptable square distance between two colors;
        // 35215 is the maximum possible value for the YIQ difference metric
        var maxDelta = 35215 * threshold * threshold,
            diff = 0;

        // compare each pixel of one image against the other one
        for (var y = 0; y < height; y+=options.stepY) {
            for (var x = 0; x < width; x+=options.stepX) {
                var pos = (y * width + x) * 4;

                // squared YUV distance between colors at this pixel position
                var delta = colorDelta(img1, img2, pos, pos);

                // the color difference is above the threshold
                if (delta > maxDelta) {
                    // check it's a real rendering difference or just anti-aliasing
                    if (!options.includeAA && (antialiased(img1, x, y, width, height, img2) ||
                                               antialiased(img2, x, y, width, height, img1))) {
                        // one of the pixels is anti-aliasing; draw as yellow and do not count as difference
                        if (output) drawPixel(output, pos, 255, 255, 0);
                    } else {
                        // found substantial difference not caused by anti-aliasing; draw it as red
                        if (output) drawPixel(output, pos, 255, 0, 0);
                        diff++;
                    }
                } else if (output) {
                    // pixels are similar; draw background as grayscale image blended with white
                    var val = blend(grayPixel(img1, pos), 0.1);
                    drawPixel(output, pos, val, val, val);
                }
            }
        }
        // return the number of different pixels
        return diff;
    }

    // check if a pixel is likely a part of anti-aliasing;
    // based on "Anti-aliased Pixel and Intensity Slope Detector" paper by V. Vysniauskas, 2009
    function antialiased(img, x1, y1, width, height, img2) {
        var x0 = Math.max(x1 - 1, 0),
            y0 = Math.max(y1 - 1, 0),
            x2 = Math.min(x1 + 1, width - 1),
            y2 = Math.min(y1 + 1, height - 1),
            pos = (y1 * width + x1) * 4,
            zeroes = 0,
            positives = 0,
            negatives = 0,
            min = 0,
            max = 0,
            minX, minY, maxX, maxY;

        // go through 8 adjacent pixels
        for (var x = x0; x <= x2; x++) {
            for (var y = y0; y <= y2; y++) {
                if (x === x1 && y === y1) continue;

                // brightness delta between the center pixel and adjacent one
                var delta = colorDelta(img, img, pos, (y * width + x) * 4, true);

                // count the number of equal, darker and brighter adjacent pixels
                if (delta === 0) zeroes++;
                else if (delta < 0) negatives++;
                else if (delta > 0) positives++;

                // if found more than 2 equal siblings, it's definitely not anti-aliasing
                if (zeroes > 2) return false;

                if (!img2) continue;

                // remember the darkest pixel
                if (delta < min) {
                    min = delta;
                    minX = x;
                    minY = y;
                }
                // remember the brightest pixel
                if (delta > max) {
                    max = delta;
                    maxX = x;
                    maxY = y;
                }
            }
        }

        if (!img2) return true;

        // if there are no both darker and brighter pixels among siblings, it's not anti-aliasing
        if (negatives === 0 || positives === 0) return false;

        // if either the darkest or the brightest pixel has more than 2 equal siblings in both images
        // (definitely not anti-aliased), this pixel is anti-aliased
        return (!antialiased(img, minX, minY, width, height) && !antialiased(img2, minX, minY, width, height)) ||
            (!antialiased(img, maxX, maxY, width, height) && !antialiased(img2, maxX, maxY, width, height));
    }

    // calculate color difference according to the paper "Measuring perceived color difference
    // using YIQ NTSC transmission color space in mobile applications" by Y. Kotsarenko and F. Ramos
    function colorDelta(img1, img2, k, m, yOnly) {
        var a1 = img1[k + 3] / 255,
            a2 = img2[m + 3] / 255,

            r1 = blend(img1[k + 0], a1),
            g1 = blend(img1[k + 1], a1),
            b1 = blend(img1[k + 2], a1),

            r2 = blend(img2[m + 0], a2),
            g2 = blend(img2[m + 1], a2),
            b2 = blend(img2[m + 2], a2),

            y = rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2);

        if (yOnly) return y; // brightness difference only

        var i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2),
            q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2);

        return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
    }

    function rgb2y(r, g, b) { return r * 0.29889531 + g * 0.58662247 + b * 0.11448223; }
    function rgb2i(r, g, b) { return r * 0.59597799 - g * 0.27417610 - b * 0.32180189; }
    function rgb2q(r, g, b) { return r * 0.21147017 - g * 0.52261711 + b * 0.31114694; }

    // blend semi-transparent color with white
    function blend(c, a) {
        return 255 + (c - 255) * a;
    }

    function drawPixel(output, pos, r, g, b) {
        output[pos + 0] = r;
        output[pos + 1] = g;
        output[pos + 2] = b;
        output[pos + 3] = 255;
    }

    function grayPixel(img, i) {
        var a = img[i + 3] / 255,
            r = blend(img[i + 0], a),
            g = blend(img[i + 1], a),
            b = blend(img[i + 2], a);
        return rgb2y(r, g, b);
    }
})();
