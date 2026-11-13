import { MongoClient, Db } from 'mongodb';

const client = new MongoClient("mongodb+srv://alacostap_db_user:3span4@cluster0.6xeyesk.mongodb.net/");

export const connectMongo = ():Promise<Db> => {

    return client.connect().then(()=>{
        console.log("Conectado al Mongo");

        return client.db("Banco");
    }).catch((error)=>{
        console.log("Error al conectar con Mongo");
        throw error;
    })

}
