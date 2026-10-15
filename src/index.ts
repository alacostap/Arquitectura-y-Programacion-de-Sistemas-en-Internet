import express from "express";

type LibroT = {
    id : number,
    titulo : string,
    autor : string,
    año : number,
    disponible : boolean
}

type PrestamosT = {
    id : number,
    libroId : number,
    usuario : string,
    fechaPrestamo : string,
    fechaDevolucion : string | null
}

let libros: LibroT[] = [
  { id: 1, titulo: "Clean Code", autor: "Robert C. Martin", año: 2008, disponible: true },
  { id: 2, titulo: "El Quijote", autor: "Miguel de Cervantes", año: 1605, disponible: true },
  { id: 3, titulo: "Sapiens", autor: "Yuval Noah Harari", año: 2011, disponible: false }
];
 
let prestamos: PrestamosT[] = [
  { id: 1, libroId: 3, usuario: "Ana", fechaPrestamo: "2026-10-01", fechaDevolucion: null }
];

//----------------------------------------------------------------------------------------------------

const app = express();

app.use(express.json());

//----------------------------------------------------------------------------------------------------

app.get("/libros", (req, res) => {
   res.json(libros);
});

app.get("/libros/:id", (req, res) => {


   const miId = Number(req.params.id);
   const libroBuscado = libros.find((x) => x.id === miId);


   if(!libroBuscado) {
       res.status(404).json({
           message : "Ese libro no lo tengo"
       });
       return
   };


   res.json(libroBuscado);
});

app.post("/libros", (req, res) => {


   if (!req.body) {
       res.status(400).json({
           message : "Me tienes que pasar algo"
       })
       return
   }

   if ((!req.body.titulo || !req.body.autor || !req.body.año)) {
       res.status(400).json({
           message : "Me falta algun campo"
       })
       return
   }

   const nuevoLibro : LibroT = {
       id : Math.random(),
       titulo : req.body.titulo,
       autor : req.body.autor,
       año : req.body.año,
       disponible : true
   }


   libros.push(nuevoLibro);


   res.status(201).json({
       message : "Se ha creado el libro",
       libro : nuevoLibro
   });
})

app.delete("/libros/:id", (req, res) => {
   const id = Number(req.params.id);


   const libroEliminar = libros.find(x => x.id === id);


   if (!libroEliminar) {
       res.status(400).json({
           message : "No puedo eliminarla si no existe"
       })
       return
   }


   const nuevaListaFiltrada = libros.filter((x) => !(x.id === id));


   libros = nuevaListaFiltrada;


   res.json({
       message : `La pelicula ${libroEliminar.titulo} ha sido eliminada`
   })
});

app.put("/libros/:id", (req, res) => {
    const id = Number(req.params.id);

    const libroEliminar = libros.find((x) => x.id === id);

    if (!libroEliminar) {
        res.status(404).json({
            message: "Ese libro no existe"
        });
        return;
    }

    if (!req.body) {
        res.status(400).json({
            message: "Me tienes que pasar algo"
        });
        return;
    }

   if ((!req.body.titulo || !req.body.autor || !req.body.año || req.body.disponible)) {
       res.status(400).json({
           message : "Me falta algun campo"
       })
       return
   }

    const libroActualizar: LibroT = {
        id,
        titulo: req.body.titulo,
        autor: req.body.autor,
        año: req.body.año,
        disponible: req.body.disponible
    };

    libros = libros.map((x) => x.id === id ? libroActualizar : x);

    res.json({
        message: "Libro actualizado",
        libro: libroActualizar
    });
});

app.patch("/libros/:id", (req, res) => {
   const id = Number(req.params.id);


   const libroCambiar= libros.find((x) => x.id === id);


   if (!libroCambiar) {
       res.status(404).json({
           message : "Esa peli no existe, no se puede eliminar"
       })
       return
   }


   if(!req.body) {
       res.status(400).json({
           message : "Me tienes que pasar algo"
       })
       return
   }


   if ((!req.body.titulo || !req.body.autor || !req.body.año || req.body.disponible)) {
       res.status(400).json({
           message : "Me falta algun campo"
       })
       return
   }

   const libroActualizado : LibroT = {
       id,
       titulo : req.body.titulo ? req.body.titulo : libroCambiar.titulo,
       autor : req.body.autor ? req.body.autor : libroCambiar.autor,
       año : req.body.año ? req.body.año : libroCambiar.año,
       disponible : req.body.disponible ? req.body.disponible : libroCambiar.disponible
   }


   libros = libros.map((x) => x.id === id ? libroActualizado : x);


   res.json({
       message : "Cambiado a medias o entero"
   })
  
})

//----------------------------------------------------------------------------------

app.get("/prestamos", (req, res) => {
   res.json(prestamos);
});

app.get("/libros/:id/prestamos", (req, res) => {
   const id = Number(req.params.id);
   const libro = libros.find((x) => x.id === id);

   if (!libro) {
       res.status(404).json({
           message: "El libro no existe"
       });
       return;
   }

   const historial = prestamos.filter((x) => x.libroId === id);

   res.status(201).json({
       libro,
       prestamos: historial
   });
});

app.post("/libros/:id/prestar", (req, res) => {

    const id = Number(req.params.id);
    const libro = libros.find((x) => x.id === id);

    if (!libro) {
        res.status(404).json({
            message: "El libro no existe"
        });
        return;
    }

    if (!req.body.usuario || typeof req.body.usuario !== "string" || !req.body.usuario.trim()) {
        res.status(400).json({
            message: "Tienes que dar un usuario"
        });
        return;
    }

    if (!libro.disponible) {
        res.status(409).json({
            message: "El libro ya esta prestado"
        });
        return;
    }

    const prestamosUsuario = prestamos.filter(
        (x) => x.usuario === req.body.usuario.trim() && x.fechaDevolucion === null
    );

    if (prestamosUsuario.length >= 2) {
        res.status(409).json({
            message: "El usuario ya tiene 2 libros prestados"
        });
        return;
    }

    const nuevoPrestamo: PrestamosT = {
        id: prestamos.length > 0 ? Math.max(...prestamos.map((x) => x.id)) + 1 : 1,
        libroId: id,
        usuario: req.body.usuario.trim(),
        fechaPrestamo: new Date().toISOString().split("T")[0],
        fechaDevolucion: null
    };

    prestamos.push(nuevoPrestamo);

    libros = libros.map((x) =>
        x.id === id ? { ...x, disponible: false } : x
    );

    res.status(201).json(nuevoPrestamo);

});

app.post("/libros/:id/devolver", (req, res) => {

    const id = Number(req.params.id);
    const libro = libros.find((x) => x.id === id);

    if (!libro) {
        res.status(404).json({
            message: "El libro no existe"
        });
        return;
    }

    if (libro.disponible) {
        res.status(409).json({
            message: "El libro no está prestado"
        });
        return;
    }

    const prestamoActivo = prestamos.find(
        (x) => x.libroId === id && x.fechaDevolucion === null
    );

    if (!prestamoActivo) {
        res.status(404).json({
            message: "No se ha encontrado el préstamo activo"
        });
        return;
    }

    prestamoActivo.fechaDevolucion = new Date().toString();

    libros = libros.map((x) =>
        x.id === id ? { ...x, disponible: true } : x
    );

    res.json({
        message: "Libro devuelto correctamente",
        prestamo: prestamoActivo
    });

});

//----------------------------------------------------------------------------------

app.get("/estadisticas", (req, res) => {


  const totalLibros = libros.length;
  const librosDisponibles = libros.filter((x) => x.disponible === true).length;
  const librosPrestados = libros.filter((x) => x.disponible === false).length;
  const totalPrestamos = prestamos.length;
  const prestamosActivos = prestamos.filter((x) => x.fechaDevolucion === null).length;


  res.status(200).json({
      totalLibros : totalLibros, librosDisponibles : librosDisponibles, 
      librosPrestados : librosPrestados, totalPrestamos : totalPrestamos, 
      prestamosActivos : prestamosActivos});
});


//----------------------------------------------------------------------------------

const PORT = 3000;

app.listen(PORT, () => {
   console.log(`El api esta furulando en el puerto ${PORT}`)
})
