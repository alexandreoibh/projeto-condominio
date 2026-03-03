const express = require('express');
const router = express.Router();
const UploadsController = require('../controllers/uploadsController');
const multer = require("multer");
const auth = require('../helpers/auth');
const mkdirp = require("mkdirp");
const path = require('path');
const fs = require('fs');


// const storage = multer.diskStorage({

//     destination: function (req, file, cb) {
//         const idUsuarioSet = req.query.idUsuarioSet;
//         let pastaAvatar = mkdirp.sync("src/uploads/banners/" + idUsuarioSet);
//         cb(null, 'src/uploads/banners/'+idUsuarioSet);
//     },
//     filename: function (req, file, cb) {
//         console.log(file,'Aquiiii foto',file.originalname )
//         const idUsuarioSet = req.query.idUsuarioSet;
//         cb(null, new Date().toISOString().replace(/:/g, '-') + req.idcliente+'.'+file.mimetype.split('/')[1])
//         // cb(null, idUsuarioSet+'.'+file.mimetype.split('/')[1])
//     }
// });

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const { idPasta, pasta } = req.query;
        // let pastaAvatar = mkdirp.sync("src/tmp/" + pasta);
        // pastaAvatar = mkdirp.sync("src/tmp/" + pasta + "/" + idPasta);
        // cb(null, 'src/tmp/' + pasta + '/' + idPasta);
        cb(null, '/tmp');
       
    },
    filename: function (req, file, cb) {
        // cb(null, new Date().toISOString().replace(/:/g, '-') + file.originalname)
        cb(null, file.originalname)
    }
});

const upload = multer({ storage });

const uploadsItem = new UploadsController();

router.get('/', auth, uploadsItem.index.bind(uploadsItem));
router.get('/pasta', auth, uploadsItem.getPasta.bind(uploadsItem));
router.get('/anexos/:id', auth, uploadsItem.getAnexos.bind(uploadsItem));
router.get('/pastasUploads/:pk_id_tb_documentos_modulo/:pk_id_tb_modulo', auth, uploadsItem.getPastasUploads.bind(uploadsItem));
router.get('/pastasUploadsSun/:id_pai', auth, uploadsItem.getPastasUploadsSun.bind(uploadsItem));
router.get('/fileDownload/:id', auth, uploadsItem.getFileDownload.bind(uploadsItem));
router.get('/pastasUploadsDefault/', auth, uploadsItem.getPastasUploadsDefault.bind(uploadsItem));


router.post('/', auth, upload.single('projeto'), uploadsItem.store.bind(uploadsItem));
router.post('/documents', auth, upload.single('projeto'), uploadsItem.storeDocuments.bind(uploadsItem));
router.post('/folderUploadsFiles', auth, upload.single('projeto'), uploadsItem.storeDocumentsFolder.bind(uploadsItem));
router.post('/folder', auth, uploadsItem.postFolder.bind(uploadsItem));
router.post('/folderDefault', auth, uploadsItem.postFolderDefault.bind(uploadsItem));
router.post('/foldersCreateDefault', auth, uploadsItem.postFoldersCreateDefault.bind(uploadsItem));

router.delete('/:id', auth, uploadsItem.destroy.bind(uploadsItem));
router.delete('/documents/:id', auth, uploadsItem.destroyDocuments.bind(uploadsItem));
router.delete('/folder/:id', auth, uploadsItem.destroyFolder.bind(uploadsItem));
router.delete('/file/:id', auth, uploadsItem.destroyFile.bind(uploadsItem));
router.delete('/folderDefault/:id', auth, uploadsItem.destroyFolderDefault.bind(uploadsItem));

module.exports = router;

