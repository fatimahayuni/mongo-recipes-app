// 1. SETUP BEGINS
const express = require('express');
const cors = require("cors");
require('dotenv').config();
const MongoClient = require("mongodb").MongoClient;
const { ObjectId } = require("mongodb"); // Add this line to import ObjectId
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(403);
    jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

const generateAccessToken = (id, email) => {
    return jwt.sign({
        'user_id': id,
        'email': email
    }, process.env.TOKEN_SECRET, {
        expiresIn: "1h"
    });
};

const mongoUri = process.env.MONGO_URI;
const dbname = "recipe_book";

let app = express();

// Enable processing JSON data
app.use(express.json());

// Enable cors
app.use(cors());

async function connect(uri, dbname) {
    let client = await MongoClient.connect(uri, {
        useUnifiedTopology: true
    });
    let db = client.db(dbname);
    return db;
}

// SETUP END
async function main() {
    const db = await connect(mongoUri, dbname);

    // GET route to fetch all recipes with query filters
    app.get('/recipes', async (req, res) => {
        try {
            const { tags, cuisine, ingredients, name } = req.query;
            let query = {};

            if (tags) {
                query['tags.name'] = { $in: tags.split(',') };
            }

            if (cuisine) {
                query['cuisine.name'] = { $regex: cuisine, $options: 'i' };
            }

            if (ingredients) {
                query['ingredients.name'] = { $all: ingredients.split(',').map(i => new RegExp(i, 'i')) };
            }

            if (name) {
                query.name = { $regex: name, $options: 'i' };
            }

            const recipes = await db.collection('recipes').find(query).project({
                name: 1,
                'cuisine.name': 1,
                'tags.name': 1,
                _id: 0
            }).toArray();

            res.json({ recipes });
        } catch (error) {
            console.error('Error searching recipes:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // GET route to fetch a single recipe by ID
    app.get("/recipes/:id", async (req, res) => {
        try {
            const id = req.params.id;

            // Fetch the recipe by ID
            const recipe = await db.collection("recipes").findOne(
                { _id: new ObjectId(id) },
                { projection: { _id: 0 } } // Exclude _id from the result
            );

            if (!recipe) {
                return res.status(404).json({ error: "Recipe not found" });
            }

            res.json(recipe);
        } catch (error) {
            console.error("Error fetching recipe:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    // POST route to create a new recipe
    app.post('/recipes', async (req, res) => {
        try {
            const { name, cuisine, prepTime, cookTime, servings, ingredients, instructions, tags } = req.body;

            // Basic validation
            if (!name || !cuisine || !ingredients || !instructions || !tags) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Fetch the cuisine document
            const cuisineDoc = await db.collection('cuisines').findOne({ name: cuisine });
            if (!cuisineDoc) {
                return res.status(400).json({ error: 'Invalid cuisine' });
            }

            // Fetch the tag documents
            const tagDocs = await db.collection('tags').find({ name: { $in: tags } }).toArray();
            if (tagDocs.length !== tags.length) {
                return res.status(400).json({ error: 'One or more invalid tags' });
            }

            // Create the new recipe object
            const newRecipe = {
                name,
                cuisine: {
                    _id: cuisineDoc._id,
                    name: cuisineDoc.name
                },
                prepTime,
                cookTime,
                servings,
                ingredients,
                instructions,
                tags: tagDocs.map(tag => ({
                    _id: tag._id,
                    name: tag.name
                }))
            };

            // Insert the new recipe into the database
            const result = await db.collection('recipes').insertOne(newRecipe);

            // Send back the created recipe
            res.status(201).json({
                message: 'Recipe created successfully',
                recipeId: result.insertedId
            });
        } catch (error) {
            console.error('Error creating recipe:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // PUT route to update a recipe by ID
    app.put('/recipes/:id', async (req, res) => {
        try {
            const id = req.params.id;
            const { name, cuisine, prepTime, cookTime, servings, ingredients, instructions, tags } = req.body;

            // Basic validation
            if (!name || !cuisine || !ingredients || !instructions || !tags) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Fetch the cuisine document
            const cuisineDoc = await db.collection('cuisines').findOne({ name: cuisine });
            if (!cuisineDoc) {
                return res.status(400).json({ error: 'Invalid cuisine' });
            }

            // Fetch the tag documents
            const tagDocs = await db.collection('tags').find({ name: { $in: tags } }).toArray();
            if (tagDocs.length !== tags.length) {
                return res.status(400).json({ error: 'One or more invalid tags' });
            }

            // Create the updated recipe object
            const updatedRecipe = {
                name,
                cuisine: {
                    _id: cuisineDoc._id,
                    name: cuisineDoc.name
                },
                prepTime,
                cookTime,
                servings,
                ingredients,
                instructions,
                tags: tagDocs.map(tag => ({
                    _id: tag._id,
                    name: tag.name
                }))
            };

            // Update the recipe in the database
            const result = await db.collection('recipes').updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedRecipe }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: 'Recipe not found' });
            }

            res.json({ message: 'Recipe updated successfully' });
        } catch (error) {
            console.error('Error updating recipe:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // DELETE route to delete a recipe by ID
    app.delete('/recipes/:id', async (req, res) => {
        try {
            const recipeId = req.params.id;

            // Attempt to delete the recipe
            const result = await db.collection('recipes').deleteOne({ _id: new ObjectId(recipeId) });

            if (result.deletedCount === 0) {
                return res.status(404).json({ error: 'Recipe not found' });
            }

            res.json({ message: 'Recipe deleted successfully' });
        } catch (error) {
            console.error('Error deleting recipe:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // POST route to add a review to a recipe by ID
    app.post('/recipes/:id/reviews', async (req, res) => {
        try {
            const recipeId = req.params.id;
            const { user, rating, comment } = req.body;

            // Basic validation
            if (!user || !rating || !comment) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Create the new review object
            const newReview = {
                review_id: new ObjectId(),
                user,
                rating: Number(rating),
                comment,
                date: new Date()
            };

            // Add the review to the recipe
            const result = await db.collection('recipes').updateOne(
                { _id: new ObjectId(recipeId) },
                { $push: { reviews: newReview } }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: 'Recipe not found' });
            }

            res.status(201).json({
                message: 'Review added successfully',
                reviewId: newReview.review_id
            });
        } catch (error) {
            console.error('Error adding review:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // POST route to create a new user
    app.post('/users', async function (req, res) {
        try {
            console.log("Request body:", req.body); // Log request body for debugging
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ message: 'Email and password are required' });
            }

            const hashedPassword = await bcrypt.hash(password, 12);
            const result = await db.collection("users").insertOne({
                email,
                password: hashedPassword
            });

            res.status(201).json({
                message: "New user account created",
                userId: result.insertedId
            });
        } catch (error) {
            console.error("Error creating user:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });

    // POST route for user login
    app.post('/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }
        const user = await db.collection('users').findOne({ email: email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid password' });
        }
        const accessToken = generateAccessToken(user._id, user.email);
        res.json({ accessToken: accessToken });
    });


    // GET protected route to fetch user      
    app.get('/profile', verifyToken, (req, res) => {
        res.json({ message: 'This is a protected route', user: req.user });
    });

    app.listen(3010, () => {
        console.log("Server has started");
    });
}

main();
